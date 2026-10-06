import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Config, Mode } from '../packages/core/types.js';
import { Store } from '../packages/storage/index.js';
import { createProxy } from '../apps/proxy/index.js';

const fixtureRoot = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
export interface BenchmarkCase { id: string; file: string; prompt: string; expected: RegExp }
export const cases: BenchmarkCase[] = [
  { id: 'json-analysis', file: 'orders.json', prompt: 'Return only the order ID whose total is 91.25.', expected: /^ord_104$/i },
  { id: 'log-analysis', file: 'server.log', prompt: 'Return only the request ID of the first database timeout.', expected: /^req_c73a$/i },
  { id: 'code-bug', file: 'bug.py', prompt: 'Return only the function name with the off-by-one loop bug.', expected: /^mean_window$/i },
  { id: 'stack-trace', file: 'trace.txt', prompt: 'Return only the file and line at the first application frame that raised the error.', expected: /^src\/billing\/invoice.py:87$/i }
];
export interface BenchmarkRow { task: string; mode: Mode; answer: string; correct: boolean; tool_call_correct: boolean; input_tokens: number | null; output_tokens: number | null; cache_read_tokens: number | null; latency_ms: number; status: number }

function makeRequest(task: BenchmarkCase, model: string): Record<string, unknown> {
  const text = readFileSync(join(fixtureRoot, task.file), 'utf8');
  return { model, max_tokens: 128, temperature: 0, stream: false,
    tools: [{ name: 'read_fixture', description: 'Read the benchmark fixture', input_schema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } }],
    messages: [
      { role: 'user', content: task.prompt },
      { role: 'assistant', content: [{ type: 'tool_use', id: 'toolu_benchmark_1', name: 'read_fixture', input: { name: task.file } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_benchmark_1', content: text }] }
    ] };
}

export async function runBenchmarks(config: Config, model: string, apiKey: string, store: Store): Promise<BenchmarkRow[]> {
  const modes: Mode[] = ['passthrough', 'text', 'image', 'adaptive'];
  const rows: BenchmarkRow[] = [];
  for (const mode of modes) {
    const localConfig: Config = JSON.parse(JSON.stringify(config));
    localConfig.mode = mode;
    localConfig.compression.image.enabled = mode === 'image' || mode === 'adaptive';
    const proxy = createProxy(localConfig, store);
    await new Promise<void>(resolve => proxy.listen(0, '127.0.0.1', resolve));
    const port = (proxy.address() as AddressInfo).port;
    try {
      for (const task of cases) {
        const started = performance.now();
        const response = await fetch(`http://127.0.0.1:${port}/v1/messages`, {
          method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify(makeRequest(task, model))
        });
        const payload = await response.json() as { content?: { type: string; text?: string }[]; usage?: { input_tokens?: number; output_tokens?: number; cache_read_input_tokens?: number } };
        const answer = payload.content?.filter(item => item.type === 'text').map(item => item.text ?? '').join('').trim() ?? '';
        const correct = task.expected.test(answer);
        const toolCallCorrect = !payload.content?.some(item => item.type === 'tool_use');
        const requestId = response.headers.get('x-visionctx-request-id') ?? '';
        rows.push({ task: task.id, mode, answer, correct, tool_call_correct: toolCallCorrect, input_tokens: payload.usage?.input_tokens ?? null,
          output_tokens: payload.usage?.output_tokens ?? null, cache_read_tokens: payload.usage?.cache_read_input_tokens ?? null,
          latency_ms: Math.round(performance.now() - started), status: response.status });
        if (requestId) store.evaluation(`${requestId}_${task.id}`, requestId, task.id, mode, correct, toolCallCorrect, {answer, status:response.status});
      }
    } finally { await new Promise<void>(resolve => proxy.close(() => resolve())); }
  }
  return rows;
}
