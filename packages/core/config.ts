import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import YAML from 'yaml';
import type { Config, Mode } from './types.js';

const modes = new Set<Mode>(['passthrough', 'text', 'image', 'adaptive']);
export function loadConfig(path = 'visionctx.config.yaml'): Config {
  const parsed = YAML.parse(readFileSync(resolve(path), 'utf8')) as Config;
  if (!parsed || !modes.has(parsed.mode)) throw new Error('Invalid mode in configuration');
  if (!parsed.security?.redact_secrets || parsed.security.persist_sensitive_content) throw new Error('Unsafe security settings are not supported');
  if (parsed.compression.summary?.enabled && (!Number.isInteger(parsed.compression.summary.threshold_bytes) || parsed.compression.summary.threshold_bytes < 1)) throw new Error('Invalid summary threshold');
  for (const limit of [parsed.compression.image.max_width, parsed.compression.image.max_height, parsed.compression.image.max_pages ?? 16, parsed.compression.image.max_source_bytes ?? 1048576]) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid image limit in configuration');
  }
  for (const port of [parsed.proxy?.port, parsed.dashboard?.port]) {
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid port in configuration');
  }
  const hosts = process.env.VISIONCTX_IN_CONTAINER === '1' ? ['127.0.0.1', 'localhost', '::1', '0.0.0.0'] : ['127.0.0.1', 'localhost', '::1'];
  if (!hosts.includes(parsed.proxy.host) || !hosts.includes(parsed.dashboard.host)) {
    throw new Error('Only loopback hosts are supported until dashboard authentication is implemented');
  }
  const upstream = new URL(process.env.VISIONCTX_UPSTREAM ?? parsed.proxy.upstream);
  if (upstream.protocol !== 'https:' && !['127.0.0.1', 'localhost', '::1'].includes(upstream.hostname)) {
    throw new Error('Non-local upstream must use HTTPS');
  }
  if (upstream.pathname !== '/' || upstream.search || upstream.hash) throw new Error('Upstream must be an origin URL');
  parsed.proxy.upstream = upstream.origin;
  return parsed;
}
