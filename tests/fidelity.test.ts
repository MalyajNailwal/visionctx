import test from 'node:test';
import assert from 'node:assert/strict';
import { renderText } from '../packages/image-renderer/index.js';

const samples: Record<string,string> = {
  python: 'def greet(name: str):\n    return f"héllo, {name}!"\n',
  typescript: 'const count: number = 42;\nexport const path = "src/app.ts:18";\n',
  javascript: 'function add(a, b) {\n  return a + b;\n}\n',
  sql: 'SELECT id, total FROM orders\nWHERE total = 91.25;\n',
  json: '{\n  "amount": 91.25,\n  "id": "ord_104"\n}\n',
  yaml: 'service:\n  host: 127.0.0.1\n  port: 8787\n',
  markdown: '# Release notes\n\n- Fixed `src/a.ts`\n',
  html: '<main class="shell">\n  <p>你好 — café</p>\n</main>\n',
  logs: '2026-10-05T11:07:02Z ERROR request_id=req_c73a duration_ms=3000\n',
  trace: 'Traceback (most recent call last):\n  File "src/app.py", line 42\nValueError: bad value\n',
  terminal: '$ npm test\nPASS tests/core.test.ts\nexit code: 0\n'
};

const options: Parameters<typeof renderText>[1] = { enabled:true, font_family:'monospace', font_size:12, line_height:16,
  padding:12, max_width:1000, max_height:1000, theme:'dark', line_numbers:true, word_wrap:true };

test('all supported text families render as bounded PNG with one row per source line', () => {
  for (const [kind,source] of Object.entries(samples)) {
    const pages = renderText(source, options);
    assert.equal(pages.length,1,kind);
    assert.deepEqual(pages[0]?.bytes.subarray(0,8),Buffer.from([137,80,78,71,13,10,26,10]),kind);
    assert.equal(pages[0]?.height, options.padding*2 + source.split('\n').length*options.line_height,kind);
    assert.ok(pages[0]!.width<=options.max_width,kind);
  }
});
