import { createServer, type IncomingMessage, type ServerResponse, type OutgoingHttpHeaders } from 'node:http';
import http from 'node:http';
import https from 'node:https';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import type { Config } from '../../packages/core/types.js';
import { Store } from '../../packages/storage/index.js';
import { inspectAnthropic, setAtPath } from '../../packages/request-inspector/index.js';
import { selectStrategy } from '../../packages/compression-engine/index.js';
import { redact } from '../../packages/security/index.js';
import { forwardHeaders, isMessagesPath, usageFromJson } from '../../packages/adapters/anthropic/index.js';
import { estimateCost, lookupPricing } from '../../packages/cost-engine/index.js';

const maxRequestBytes = 64 * 1024 * 1024;
const maxResponseCaptureBytes = 2 * 1024 * 1024;

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > maxRequestBytes) throw new Error('Request exceeds 64 MiB proxy limit');
    chunks.push(buffer);
  }
  return Buffer.concat(chunks);
}

function sseUsage(text: string): Record<string, unknown> | undefined {
  let usage: Record<string, unknown> | undefined;
  for (const event of text.split(/\r?\n\r?\n/)) {
    const data = event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trimStart()).join('\n');
    if (!data || data === '[DONE]') continue;
    try {
      const obj = JSON.parse(data) as Record<string, unknown>;
      const found = usageFromJson(obj.message) ?? usageFromJson(obj);
      if (found) usage = { ...usage, ...found };
    } catch { /* Incomplete or future SSE event. */ }
  }
  return usage;
}

export function createProxy(config: Config, store: Store) {
  const upstream = new URL(config.proxy.upstream);
  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, pid: process.pid, mode: config.mode, upstream: upstream.origin }));
      return;
    }
    const id = randomUUID();
    const started = performance.now();
    let stored = false;
    try {
      const body = await readBody(req);
      try { store.received(id, req.url ?? '/', config.mode, body.length); stored = true; } catch { /* Metadata errors cannot block API traffic. */ }
      let finalBody = body;
      if (req.method === 'POST' && req.url && isMessagesPath(req.url)) {
        const inspectStarted = performance.now();
        const inspected = inspectAnthropic(body, id);
        if (inspected) {
          try { store.parsed(id, inspected.model, inspected.streaming, inspected.blocks, performance.now() - inspectStarted); } catch { /* best effort */ }
          if (config.mode !== 'passthrough') {
            let changed = false;
            const compressionStarted = performance.now();
            for (const block of inspected.blocks) {
              block.sensitive = redact(block.text ?? '').sensitive;
              const strategy = selectStrategy(block, config);
              if (strategy.name === 'image' && !block.path.endsWith('/content')) continue;
              try {
                const renderStarted = performance.now();
                if (strategy.name === 'image') { try { store.event(id, 'IMAGE_RENDER_STARTED', 'ok', { block: block.id }); } catch { /* best effort */ } }
                const result = strategy.compress(block, config);
                block.strategy = result.strategy;
                block.reason = result.reason;
                if (strategy.name === 'image' && !result.changed) {
                  try { store.event(id, 'IMAGE_RENDER_COMPLETED', 'skipped', { block: block.id, reason: result.reason }, performance.now() - renderStarted); } catch { /* best effort */ }
                }
                if (result.changed && block.path.endsWith('/content') && result.strategy === 'image') {
                  if (!result.images?.length) throw new Error('Image strategy returned no pages');
                  result.images.forEach((image, page) => store.image(id, block, image, page));
                  setAtPath(inspected.payload, block.path, result.content);
                  try { store.event(id, 'IMAGE_RENDER_COMPLETED', 'ok', { block: block.id, pages: result.images.length }, performance.now() - renderStarted); } catch { /* best effort */ }
                  changed = true;
                } else if (result.changed && result.strategy === 'minify') {
                  setAtPath(inspected.payload, block.path, result.content);
                  changed = true;
                }
                try {
                  store.compression(id, block, result.changed, result.reason, result.images?.reduce((n, image) => n + image.estimatedImageTokens, 0) ?? null,
                    typeof result.content === 'string' ? result.content : undefined);
                } catch { /* best effort */ }
              } catch (error) {
                try { store.event(id, 'FALLBACK_USED', 'error', { block: block.id, reason: error instanceof Error ? error.message : 'Unknown render failure' }); } catch { /* best effort */ }
              }
            }
            try { store.event(id, 'COMPRESSION', 'ok', { changed }, performance.now() - compressionStarted); } catch { /* best effort */ }
            if (changed) finalBody = Buffer.from(JSON.stringify(inspected.payload));
          }
          try { store.finalPayload(id, inspected.payload); } catch { /* best effort */ }
        }
      }
      try { store.event(id, 'UPSTREAM_REQUEST'); } catch { /* best effort */ }
      const apiKey = req.headers['x-api-key'] ?? process.env.ANTHROPIC_API_KEY;
      if (config.measurement?.counterfactual_tokens && finalBody !== body && apiKey) {
        const counterfactual = JSON.parse(body.toString('utf8')) as Record<string, unknown>;
        delete counterfactual.max_tokens;
        delete counterfactual.stream;
        delete counterfactual.metadata;
        void fetch(new URL('/v1/messages/count_tokens', upstream), {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-api-key': String(apiKey), 'anthropic-version': String(req.headers['anthropic-version'] ?? '2023-06-01') },
          body: JSON.stringify(counterfactual), signal: AbortSignal.timeout(10000)
        }).then(response => response.ok ? response.json() : null).then(value => {
          if (value && typeof value.input_tokens === 'number') store.originalCount(id, value.input_tokens);
        }).catch(() => { /* Counterfactual failure must not block the request. */ });
      }
      const target = new URL(req.url ?? '/', upstream);
      const transport = target.protocol === 'https:' ? https : http;
      let activeRequest: http.ClientRequest | null = null;
      req.on('aborted', () => activeRequest?.destroy());
      const recordCost = (usage: Record<string, unknown> | undefined): void => {
        if (!usage) return;
        const request = store.request(id) as { model?: string | null } | undefined;
        if (!request?.model) return;
        const matched = lookupPricing(request.model);
        if (!matched) return;
        const number = (key: string): number => typeof usage[key] === 'number' ? usage[key] as number : 0;
        store.cost(id, matched.version, estimateCost(matched.pricing, { input: number('input_tokens'), output: number('output_tokens'), cacheRead: number('cache_read_input_tokens'), cacheWrite: number('cache_creation_input_tokens') }));
      };
      const relay = (upstreamRes: IncomingMessage, buffered?: Buffer) => {
        const responseHeaders: OutgoingHttpHeaders = { ...upstreamRes.headers, 'x-visionctx-request-id': id };
        for (const key of ['connection','transfer-encoding','keep-alive','proxy-connection']) delete responseHeaders[key];
        res.writeHead(upstreamRes.statusCode ?? 502, responseHeaders);
        if (buffered) {
          res.end(buffered);
          let usage: Record<string, unknown> | undefined;
          try { usage = usageFromJson(JSON.parse(buffered.toString('utf8'))); } catch { /* no usage */ }
          try { store.complete(id, upstreamRes.statusCode ?? 502, performance.now() - started, buffered.length, usage); } catch { /* best effort */ }
          try { recordCost(usage); } catch { /* best effort */ }
          return;
        }
        let responseSize = 0;
        let captured = '';
        upstreamRes.on('data', (chunk: Buffer) => {
          responseSize += chunk.length;
          if (Buffer.byteLength(captured) < maxResponseCaptureBytes) captured += chunk.toString('utf8');
          if (!res.write(chunk)) upstreamRes.pause();
        });
        res.on('drain', () => upstreamRes.resume());
        upstreamRes.on('end', () => {
          res.end();
          let usage: Record<string, unknown> | undefined;
          try { usage = usageFromJson(JSON.parse(captured)); } catch { usage = sseUsage(captured); }
          try { store.complete(id, upstreamRes.statusCode ?? 502, performance.now() - started, responseSize, usage); } catch { /* best effort */ }
          try { recordCost(usage); } catch { /* best effort */ }
        });
        upstreamRes.on('error', () => { if (!res.destroyed) res.destroy(); });
      };
      const dispatch = (payload: Buffer, fallback: boolean): void => {
        const headers = forwardHeaders(req.headers, target.host, payload !== body);
        if (!headers['x-api-key'] && !headers.authorization && process.env.ANTHROPIC_API_KEY) headers['x-api-key'] = process.env.ANTHROPIC_API_KEY;
        const upstreamReq = transport.request(target, { method: req.method, headers }, upstreamRes => {
          try { store.event(id, 'UPSTREAM_RESPONSE', 'ok', { status: upstreamRes.statusCode, fallback }); } catch { /* best effort */ }
          if (!fallback && payload !== body && upstreamRes.statusCode === 400) {
            const chunks: Buffer[] = [];
            upstreamRes.on('data', (chunk: Buffer) => chunks.push(chunk));
            upstreamRes.on('end', () => {
              const errorBody = Buffer.concat(chunks);
              if (/image|vision|media.type|resolution/i.test(errorBody.toString('utf8'))) {
                try { store.fallback(id, 'Upstream rejected transformed image payload'); store.finalPayload(id, JSON.parse(body.toString('utf8'))); store.event(id, 'UPSTREAM_REQUEST', 'ok', { fallback: true }); } catch { /* best effort */ }
                dispatch(body, true);
              } else relay(upstreamRes, errorBody);
            });
            upstreamRes.on('error', () => { if (!res.destroyed) res.destroy(); });
          } else relay(upstreamRes);
        });
        activeRequest = upstreamReq;
        upstreamReq.on('error', error => {
          try { store.fail(id, error.message); } catch { /* best effort */ }
          if (!res.headersSent) { res.writeHead(502, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'proxy_error', message: 'Upstream connection failed', request_id: id } })); }
          else res.destroy(error);
        });
        upstreamReq.end(payload);
      };
      dispatch(finalBody, false);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown proxy error';
      if (stored) { try { store.fail(id, message); } catch { /* best effort */ } }
      if (!res.headersSent) { res.writeHead(message.includes('64 MiB') ? 413 : 500, { 'content-type': 'application/json' }); res.end(JSON.stringify({ error: { type: 'proxy_error', message: redact(message).text, request_id: id } })); }
    }
  });
}
