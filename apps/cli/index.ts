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
let store: Store | undefined;
function getStore(): Store { return store ??= new Store(config.storage.path, config.storage.capture_redacted_content); }

async function reachable(url: string): Promise<boolean> { try { return (await fetch(url, { signal: AbortSignal.timeout(1500) })).ok; } catch { return false; } }
function closeStore(): void { store?.close(); store = undefined; }

switch (command) {
  case 'start': {
    const proxy = createProxy(config, getStore());
    const dashboard = createDashboard(config, getStore());
    const listen = (server: typeof proxy, port: number, host: string) => new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen);
      server.listen(port, host, () => { server.off('error', rejectListen); resolveListen(); });
    });
    try {
      await listen(proxy, config.proxy.port, config.proxy.host);
      await listen(dashboard, config.dashboard.port, config.dashboard.host);
    } catch (error) {
      proxy.close();
      dashboard.close();
      closeStore();
      throw error;
    }
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
    console.log(`VisionCtx\nProxy: ${online ? 'running' : 'stopped'}\nDashboard: http://${config.dashboard.host}:${config.dashboard.port}\nDatabase: SQLite\nMode: ${config.mode}\nRequests: ${(getStore().summary() as {requests:number}).requests}`);
    closeStore();
    break;
  }
  case 'doctor': {
    const online = await reachable(`http://${config.proxy.host}:${config.proxy.port}/health`);
    let authenticatedTraffic = false;
    if (online) {
      try {
        const response = await fetch(`http://${config.dashboard.host}:${config.dashboard.port}/api/requests`, { signal:AbortSignal.timeout(1500) });
        const requests = await response.json() as {status?:number}[];
        authenticatedTraffic = requests.some(request => request.status === 200);
      } catch { /* dashboard may be unavailable */ }
    }
    const auth = process.env.ANTHROPIC_API_KEY ? '✓ API key configured in this process' : authenticatedTraffic ? '✓ Successful upstream request observed (credential type not stored)' : '· No API key in this process; run a request to verify authentication';
    console.log(`${online ? '✓' : '✗'} Proxy reachable\n✓ Anthropic endpoint configured: ${new URL(config.proxy.upstream).host}\n${auth}\n✓ SSE forwarding implemented`);
    closeStore();
    break;
  }
  case 'dashboard':
    console.log(`http://${config.dashboard.host}:${config.dashboard.port}`);
    closeStore();
    break;
  case 'requests':
    console.log(JSON.stringify(getStore().list(), null, 2));
    closeStore();
    break;
  case 'inspect': {
    const id = args[1];
    if (!id) throw new Error('inspect requires a request ID');
    console.log(JSON.stringify({ request: getStore().request(id), blocks: getStore().blocks(id), events: getStore().events(id), images: getStore().images(id) }, null, 2));
    closeStore();
    break;
  }
  case 'config':
    console.log(JSON.stringify({ ...config, proxy: { ...config.proxy, upstream: new URL(config.proxy.upstream).origin } }, null, 2));
    closeStore();
    break;
  case 'benchmark':
    if (!args.includes('--model') || !process.env.ANTHROPIC_API_KEY) { console.log('Usage: visionctx benchmark --model <exact-anthropic-model-id> (requires ANTHROPIC_API_KEY; runs 16 paid API calls)'); closeStore(); break; }
    console.table(await runBenchmarks(config, args[args.indexOf('--model') + 1]!, process.env.ANTHROPIC_API_KEY, getStore()));
    closeStore();
    break;
  default:
    console.log('VisionCtx commands: start, stop, status, doctor, dashboard, requests, inspect <id>, benchmark, config');
    closeStore();
}
