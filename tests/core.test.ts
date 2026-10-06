import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, sanitize } from '../packages/security/index.js';
import { inspectAnthropic } from '../packages/request-inspector/index.js';
import { renderText } from '../packages/image-renderer/index.js';
import { estimateCost } from '../packages/cost-engine/index.js';
import { textCompression, summary, selectStrategy } from '../packages/compression-engine/index.js';
import type { Config } from '../packages/core/types.js';

test('secrets are redacted before display or storage', () => {
  const key = 'sk-ant-abcdefghijklmnopqrstuvwxyz123456';
  assert.equal(redact(`key=${key}`).text.includes(key), false);
  assert.deepEqual(sanitize({ authorization: `Bearer ${key}`, source: key }), { authorization: '[REDACTED]', source: '[REDACTED]' });
});
test('inspector finds tool results without changing the payload', () => {
  const raw = Buffer.from(JSON.stringify({ model: 'm', messages: [{ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tool_1', content: '{"a": 1}' }] }] }));
  const inspected = inspectAnthropic(raw, 'test')!;
  assert.equal(inspected.blocks.length, 1);
  assert.equal(inspected.blocks[0]?.type, 'JSON');
  assert.equal(inspected.blocks[0]?.path, '/messages/0/content/0/content');
  assert.equal((inspected.payload.messages as unknown[]).length, 1);
});
test('renderer creates real PNG pages and preserves all lines by pagination', () => {
  const pages = renderText('α = 1\n  path/to/file:42\n'.repeat(80), { enabled: true, format: 'png', font_family: 'monospace', font_size: 14, line_height: 19, padding: 10, max_width: 500, max_height: 250, theme: 'dark', line_numbers: true, word_wrap: true } as Parameters<typeof renderText>[1]);
  assert.ok(pages.length > 1);
  assert.deepEqual(pages[0]?.bytes.subarray(0,8), Buffer.from([137,80,78,71,13,10,26,10]));
  assert.ok(pages.every(page => page.width <= 500 && page.height <= 250));
});
test('cache breakpoint protects earlier tool results from transformation', () => {
  const raw = Buffer.from(JSON.stringify({ model:'m', messages:[
    {role:'user',content:[{type:'tool_result',tool_use_id:'toolu_1',content:'{"a": 1}',cache_control:{type:'ephemeral'}}]},
    {role:'user',content:[{type:'tool_result',tool_use_id:'toolu_2',content:'{"b": 2}'}]}
  ]}));
  const blocks = inspectAnthropic(raw,'test')!.blocks;
  assert.equal(blocks[0]?.risk,'high');
  assert.equal(blocks[1]?.risk,'medium');
});
test('inspector records tool calls and existing images without modifying them', () => {
  const raw=Buffer.from(JSON.stringify({model:'m',messages:[{role:'assistant',content:[{type:'tool_use',id:'toolu_1',name:'read_file',input:{path:'src/a.ts'}}]},{role:'user',content:[{type:'image',source:{type:'base64',media_type:'image/png',data:'iVBORw0KGgo='}}]}]}));
  const blocks=inspectAnthropic(raw,'test')!.blocks;
  assert.deepEqual(blocks.map(block=>block.type),['TOOL_CALL','IMAGE']);
  assert.equal(blocks[1]?.text,null);
  assert.equal(blocks[1]?.risk,'high');
});
test('cost calculation accounts for cache reads and writes separately', () => {
  const price = {input_per_million:3,output_per_million:15,cache_read_per_million:0.3,cache_write_per_million:3.75};
  assert.equal(estimateCost(price,{input:1_000_000,output:0,cacheRead:1_000_000,cacheWrite:1_000_000}),7.05);
});
test('text mode collapses repeated logs and can restore original source', () => {
  const original = ('2026-10-05T11:07:02Z ERROR same event\n').repeat(200);
  const block = inspectAnthropic(Buffer.from(JSON.stringify({model:'m',messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_1',content:original}]}]})),'test')!.blocks[0]!;
  const config = {mode:'text',compression:{adaptive:{passthrough_under_bytes:2048,minify_under_bytes:10000,image_candidate_over_bytes:50000},image:{enabled:false}}} as Config;
  assert.equal(selectStrategy(block,config).name,'text_compression');
  const result=textCompression.compress(block,config);
  assert.equal(result.strategy,'text_compression');
  assert.match(String(result.content),/previous line repeated 199 more times/);
  assert.equal(textCompression.restore(block),original);
});
test('extractive summary retains errors and marks omissions', () => {
  const original=Array.from({length:300},(_,i)=>i===150?'ERROR request_id=req_150 timeout':`INFO row ${i}`).join('\n');
  const block=inspectAnthropic(Buffer.from(JSON.stringify({model:'m',messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_1',content:original}]}]})),'test')!.blocks[0]!;
  const result=summary.compress(block,{} as Config);
  assert.equal(result.strategy,'summary');
  assert.match(String(result.content),/ERROR request_id=req_150 timeout/);
  assert.match(String(result.content),/lines omitted/);
});
