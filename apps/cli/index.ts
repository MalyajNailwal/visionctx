#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'node:fs';
import { resolve } from 'node:path';
import { loadConfig } from '../../packages/core/config.js';
import { Store } from '../../packages/storage/index.js';
import { createProxy } from '../proxy/index.js';
import { createDashboard } from '../dashboard/index.js';
import type { Mode } from '../../packages/core/types.js';
import { runBenchmarks } from '../../benchmarks/index.js';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';
if (existsSync(resolve('.env'))) process.loadEnvFile(resolve('.env'));
const configArg = args.indexOf('--config');
const config = loadConfig(configArg >= 0 ? args[configArg + 1] : undefined);
const modeArg = args.indexOf('--mode');
if (modeArg >= 0) config.mode = args[modeArg + 1] as Mode;
if (!['passthrough','text','image','adaptive'].includes(config.mode)) throw new Error('Invalid mode');
const pidPath = resolve('data/visionctx.pid');
const store = new Store(config.storage.path, config.storage.capture_redacted_content);

async function reachable(url: string): Promise<boolean> { try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } }
function closeStore(): void { store.close(); }

switch (command) {
  case 'start': {
    const proxy = createProxy(config, store);
    const dashboard = createDashboard(config, store);
    proxy.listen(config.proxy.port, config.proxy.host);
    dashboard.listen(config.dashboard.port, config.dashboard.host);
    writeFileSync(pidPath, String(process.pid), { mode: 0o600 });
    console.log(`VisionCtx ${config.mode}\nProxy: http://${config.proxy.host}:${config.proxy.port}\nDashboard: http://${config.dashboard.host}:${config.dashboard.port}`);
    const shutdown = () => { proxy.close(); dashboard.close(); if (existsSync(pidPath)) unlinkSync(pidPath); closeStore(); };
    process.once('SIGINT', shutdown);
    process.once('SIGTERM', shutdown);
    break;
  }
  case 'stop': {
    if (!existsSync(pidPath)) { console.log('VisionCtx is not running'); break; }
    const pid = Number(readFileSync(pidPath, 'utf8'));
    let runningPid: number | null = null;
    try { const response = await fetch(`http://${config.proxy.host}:${config.proxy.port}/health`, { signal: AbortSignal.timeout(1500) }); runningPid = (await response.json() as {pid?:number}).pid ?? null; } catch { /* offline */ }
    if (runningPid !== pid) { console.log('PID file does not match the running VisionCtx proxy; no process was stopped'); closeStore(); break; }
    try { process.kill(pid, 'SIGTERM'); console.log(`Stopped VisionCtx process ${pid}`); }
    catch { console.log('VisionCtx process is no longer running'); }
    closeStore();
    break;
  }
  case 'status': {
    const online = await reachable(`http://${config.proxy.host}:${config.proxy.port}/health`);
    console.log(`VisionCtx\nProxy: ${online ? 'running' : 'stopped'}\nDashboard: http://${config.dashboard.host}:${config.dashboard.port}\nDatabase: SQLite\nMode: ${config.mode}\nRequests: ${(store.summary() as {requests:number}).requests}`);
    closeStore();
    break;
  }
  case 'doctor': {
    const online = await reachable(`http://${config.proxy.host}:${config.proxy.port}/health`);
    console.log(`${online ? '✓' : '✗'} Proxy reachable\n✓ Anthropic endpoint configured: ${new URL(config.proxy.upstream).host}\n${process.env.ANTHROPIC_API_KEY ? '✓' : '✗'} API-key authentication detected\n✓ SSE forwarding implemented`);
    closeStore();
    break;
  }
  case 'dashboard':
    console.log(`http://${config.dashboard.host}:${config.dashboard.port}`);
    closeStore();
    break;
  case 'requests':
    console.log(JSON.stringify(store.list(), null, 2));
    closeStore();
    break;
  case 'inspect': {
    const id = args[1];
    if (!id) throw new Error('inspect requires a request ID');
    console.log(JSON.stringify({ request: store.request(id), blocks: store.blocks(id), events: store.events(id), images: store.images(id) }, null, 2));
    closeStore();
    break;
  }
  case 'config':
    console.log(JSON.stringify({ ...config, proxy: { ...config.proxy, upstream: new URL(config.proxy.upstream).origin } }, null, 2));
    closeStore();
    break;
  case 'benchmark':
    if (!args.includes('--model') || !process.env.ANTHROPIC_API_KEY) { console.log('Usage: visionctx benchmark --model <exact-anthropic-model-id> (requires ANTHROPIC_API_KEY; runs 16 paid API calls)'); closeStore(); break; }
    console.table(await runBenchmarks(config, args[args.indexOf('--model') + 1]!, process.env.ANTHROPIC_API_KEY));
    closeStore();
    break;
  default:
    console.log('VisionCtx commands: start, stop, status, doctor, dashboard, requests, inspect <id>, benchmark, config');
    closeStore();
}
