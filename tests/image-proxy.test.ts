import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Config } from '../packages/core/types.js';
import { Store } from '../packages/storage/index.js';
import { createProxy } from '../apps/proxy/index.js';

const listen = (server: ReturnType<typeof createServer>): Promise<number> => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
const close = (server: ReturnType<typeof createServer>): Promise<void> => new Promise(resolve => server.close(() => resolve()));
const setup = (upstream: string, wrap: boolean): Config => ({ mode: 'image', proxy: { host: '127.0.0.1', port: 8787, upstream }, dashboard: { host: '127.0.0.1', port: 8788 },
  storage: { path: 'unused', capture_redacted_content: false }, measurement: { counterfactual_tokens: false },
  compression: { adaptive: { passthrough_under_bytes: 1, minify_under_bytes: 10000, image_candidate_over_bytes: 1000 },
    image: { enabled: true, font_family: 'monospace', font_size: 8, line_height: 10, padding: 10, max_width: 1000, max_height: 1000, theme: 'dark', line_numbers: true, word_wrap: wrap } },
  security: { redact_secrets: true, persist_sensitive_content: false } });

test('image mode sends valid image blocks and stores PNG metadata', async () => {
  let forwarded: Record<string, unknown> | null = null;
  const upstream = createServer(async (req, res) => { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(chunk); forwarded = JSON.parse(Buffer.concat(chunks).toString()); res.writeHead(200, {'content-type':'application/json'}); res.end('{"usage":{"input_tokens":100,"output_tokens":2},"content":[]}'); });
  const upstreamPort = await listen(upstream);
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'visionctx-image-')), 'test.db'), false);
  const proxy = createProxy(setup(`http://127.0.0.1:${upstreamPort}`, true), store);
  const proxyPort = await listen(proxy);
  const log = Array.from({length: 600}, (_, i) => `2026-10-05T11:07:${String(i % 60).padStart(2,'0')}Z INFO request_id=req_${i} route=/api/orders status=200 duration_ms=24`).join('\n');
  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, { method:'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({model:'test',max_tokens:10,messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_1',content:log}]}]}) });
    assert.equal(response.status, 200);
    const messages = (forwarded as {messages:{content:{content:unknown}[]}[]}|null)?.messages;
    const content = messages?.[0]?.content?.[0]?.content as {type:string;source:{type:string;media_type:string;data:string}}[];
    assert.equal(content?.[0]?.type, 'image');
    assert.equal(content[0]?.source.media_type, 'image/png');
    const id = response.headers.get('x-visionctx-request-id')!;
    const images = store.images(id) as {image_path:string}[];
    assert.ok(images.length > 0);
    assert.ok(images.every(image => existsSync(image.image_path)));
  } finally { await close(proxy); await close(upstream); store.close(); }
});

test('render failure keeps original tool-result text', async () => {
  let forwarded = '';
  const upstream = createServer(async (req,res) => { const chunks:Buffer[]=[]; for await(const chunk of req) chunks.push(chunk); forwarded=Buffer.concat(chunks).toString(); res.writeHead(200,{'content-type':'application/json'}); res.end('{"content":[],"usage":{"input_tokens":1,"output_tokens":1}}'); });
  const upstreamPort = await listen(upstream);
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'visionctx-fallback-')), 'test.db'), false);
  const proxy = createProxy(setup(`http://127.0.0.1:${upstreamPort}`, false), store);
  const proxyPort = await listen(proxy);
  const log = '2026-10-05T11:07:01Z INFO ' + 'x'.repeat(2000);
  const body = JSON.stringify({model:'test',max_tokens:10,messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_1',content:log}]}]});
  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {method:'POST',headers:{'content-type':'application/json'},body});
    assert.equal(response.status,200);
    assert.equal(forwarded,body);
    const id=response.headers.get('x-visionctx-request-id')!;
    assert.ok((store.events(id) as {stage:string}[]).some(event => event.stage === 'FALLBACK_USED'));
  } finally { await close(proxy); await close(upstream); store.close(); }
});

test('image validation 400 retries once with original text', async () => {
  const bodies: string[] = [];
  const upstream = createServer(async (req,res) => {
    const chunks:Buffer[]=[]; for await(const chunk of req) chunks.push(chunk);
    bodies.push(Buffer.concat(chunks).toString());
    if (bodies.length === 1) { res.writeHead(400,{'content-type':'application/json'}); res.end('{"error":{"message":"image dimensions rejected"}}'); }
    else { res.writeHead(200,{'content-type':'application/json'}); res.end('{"content":[],"usage":{"input_tokens":12,"output_tokens":1}}'); }
  });
  const upstreamPort = await listen(upstream);
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'visionctx-retry-')), 'test.db'), false);
  const proxy = createProxy(setup(`http://127.0.0.1:${upstreamPort}`, true), store);
  const proxyPort = await listen(proxy);
  const log = Array.from({length:600},(_,i)=>`2026-10-05T11:07:01Z INFO request_id=req_${i} route=/api/orders status=200 duration_ms=24`).join('\n');
  const body = JSON.stringify({model:'test',max_tokens:10,messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_1',content:log}]}]});
  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, {method:'POST',headers:{'content-type':'application/json'},body});
    assert.equal(response.status,200);
    assert.equal(bodies.length,2);
    assert.equal(bodies[1],body);
    const id=response.headers.get('x-visionctx-request-id')!;
    assert.ok((store.events(id) as {stage:string}[]).some(event=>event.stage==='FALLBACK_USED'));
  } finally { await close(proxy); await close(upstream); store.close(); }
});
