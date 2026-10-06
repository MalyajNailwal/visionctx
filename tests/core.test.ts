import test from 'node:test';
import assert from 'node:assert/strict';
import { redact, sanitize } from '../packages/security/index.js';
import { inspectAnthropic } from '../packages/request-inspector/index.js';
import { renderText } from '../packages/image-renderer/index.js';

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
