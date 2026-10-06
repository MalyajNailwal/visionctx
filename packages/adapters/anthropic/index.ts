import type { IncomingHttpHeaders } from 'node:http';
export function isMessagesPath(path: string): boolean { return new URL(path, 'http://localhost').pathname === '/v1/messages'; }
export function usageFromJson(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const usage = (value as Record<string, unknown>).usage;
  return usage && typeof usage === 'object' && !Array.isArray(usage) ? usage as Record<string, unknown> : undefined;
}
export function forwardHeaders(headers: IncomingHttpHeaders, upstreamHost: string, changedBody: boolean): IncomingHttpHeaders {
  const filtered: IncomingHttpHeaders = { ...headers, host: upstreamHost };
  for (const key of ['connection','proxy-connection','keep-alive','transfer-encoding','te','trailer','upgrade','proxy-authenticate','proxy-authorization']) delete filtered[key];
  if (changedBody) { delete filtered['content-length']; delete filtered['content-encoding']; }
  return filtered;
}
