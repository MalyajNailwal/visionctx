import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createProxy } from '../apps/proxy/index.js';
import { Store } from '../packages/storage/index.js';
import type { Config } from '../packages/core/types.js';
import { gzipSync } from 'node:zlib';

const config = (upstream: string, path: string): Config => ({
  mode: 'passthrough', proxy: { host: '127.0.0.1', port: 8787, upstream }, dashboard: { host: '127.0.0.1', port: 8788 },
  storage: { path, capture_redacted_content: false },
  compression: { adaptive: { passthrough_under_bytes: 2048, minify_under_bytes: 10000, image_candidate_over_bytes: 50000 },
    image: { enabled: false, font_family: 'monospace', font_size: 14, line_height: 19, padding: 20, max_width: 1400, max_height: 1400, theme: 'dark', line_numbers: true, word_wrap: true } },
  security: { redact_secrets: true, persist_sensitive_content: false }
});
const listen = (server: ReturnType<typeof createServer>): Promise<number> => new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve((server.address() as AddressInfo).port)));
const close = (server: ReturnType<typeof createServer>): Promise<void> => new Promise(resolve => server.close(() => resolve()));

test('passthrough preserves JSON bytes, headers, status and response body', async () => {
  const body = Buffer.from('{ "model" : "test-model", "messages" : [ { "role" : "user", "content" : "Hi" } ], "max_tokens": 4 }');
  let received = Buffer.alloc(0);
  let header = '';
  const upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk);
    received = Buffer.concat(chunks);
    header = String(req.headers['anthropic-version']);
    res.writeHead(418, { 'content-type': 'application/json', 'x-upstream': 'yes' });
    res.end('{"error":"teapot"}');
  });
  const upstreamPort = await listen(upstream);
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'visionctx-test-')), 'test.db'), false);
  const proxy = createProxy(config(`http://127.0.0.1:${upstreamPort}`, 'unused'), store);
  const proxyPort = await listen(proxy);
  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, { method: 'POST', headers: { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }, body });
    assert.equal(response.status, 418);
    assert.equal(response.headers.get('x-upstream'), 'yes');
    assert.equal(await response.text(), '{"error":"teapot"}');
    assert.deepEqual(received, body);
    assert.equal(header, '2023-06-01');
    assert.equal((store.summary() as {requests:number}).requests, 1);
  } finally { await close(proxy); await close(upstream); store.close(); }
});

test('SSE events stream through without content changes', async () => {
  const sse = 'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":7,"output_tokens":1}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":3}}\n\n';
  const upstream = createServer((_req, res) => {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write(sse.slice(0, 70));
    setTimeout(() => res.end(sse.slice(70)), 10);
  });
  const upstreamPort = await listen(upstream);
  const store = new Store(join(mkdtempSync(join(tmpdir(), 'visionctx-test-')), 'test.db'), false);
  const proxy = createProxy(config(`http://127.0.0.1:${upstreamPort}`, 'unused'), store);
  const proxyPort = await listen(proxy);
  try {
    const response = await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: 'test', messages: [], stream: true }) });
    assert.equal(await response.text(), sse);
    await new Promise(resolve => setTimeout(resolve, 20));
    const request = store.list(1)[0] as { final_tokens: number; output_tokens: number };
    assert.equal(request.final_tokens, 7);
    assert.equal(request.output_tokens, 3);
  } finally { await close(proxy); await close(upstream); store.close(); }
});

test('proxy process API key is forwarded only when the client supplies none', async () => {
  const previous=process.env.ANTHROPIC_API_KEY;
  process.env.ANTHROPIC_API_KEY='unit-test-process-key';
  const seen:string[]=[];
  const upstream=createServer(async (req,res)=>{
    for await (const _chunk of req) { /* consume body */ }
    seen.push(String(req.headers['x-api-key'] ?? ''));
    res.writeHead(200,{'content-type':'application/json'});
    res.end('{"usage":{"input_tokens":1,"output_tokens":1},"content":[]}');
  });
  const upstreamPort=await listen(upstream);
  const store=new Store(join(mkdtempSync(join(tmpdir(),'visionctx-auth-')),'test.db'),false);
  const proxy=createProxy(config(`http://127.0.0.1:${upstreamPort}`,'unused'),store);
  const proxyPort=await listen(proxy);
  try {
    const body=JSON.stringify({model:'test',messages:[],max_tokens:1});
    await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`,{method:'POST',headers:{'content-type':'application/json'},body});
    await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`,{method:'POST',headers:{'content-type':'application/json','x-api-key':'client-key'},body});
    assert.deepEqual(seen,['unit-test-process-key','client-key']);
    assert.doesNotMatch(JSON.stringify(store.list()),/unit-test-process-key|client-key/);
  } finally {
    await close(proxy); await close(upstream); store.close();
    if (previous===undefined) delete process.env.ANTHROPIC_API_KEY; else process.env.ANTHROPIC_API_KEY=previous;
  }
});

test('compressed SSE remains transparent while usage is extracted', async () => {
  const sse='event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":12,"output_tokens":1,"cache_read_input_tokens":5}}}\n\nevent: message_delta\ndata: {"type":"message_delta","usage":{"output_tokens":4}}\n\n';
  const gzipped=gzipSync(sse);
  const upstream=createServer((_req,res)=>{res.writeHead(200,{'content-type':'text/event-stream','content-encoding':'gzip'});res.end(gzipped);});
  const upstreamPort=await listen(upstream);
  const store=new Store(join(mkdtempSync(join(tmpdir(),'visionctx-gzip-')),'test.db'),false);
  const proxy=createProxy(config(`http://127.0.0.1:${upstreamPort}`,'unused'),store);
  const proxyPort=await listen(proxy);
  try {
    const response=await fetch(`http://127.0.0.1:${proxyPort}/v1/messages`,{method:'POST',headers:{'content-type':'application/json','accept-encoding':'gzip'},body:JSON.stringify({model:'test',messages:[],stream:true})});
    assert.equal(await response.text(),sse);
    await new Promise(resolve=>setTimeout(resolve,20));
    const request=store.list(1)[0] as {final_tokens:number;output_tokens:number};
    assert.equal(request.final_tokens,17);
    assert.equal(request.output_tokens,4);
  } finally { await close(proxy); await close(upstream); store.close(); }
});
