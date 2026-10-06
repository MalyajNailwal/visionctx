import { createServer } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Config } from '../../packages/core/types.js';
import { Store } from '../../packages/storage/index.js';

const root = join(dirname(fileURLToPath(import.meta.url)), 'public');
const idPattern = /^[0-9a-f-]{36}$/i;
function json(res: import('node:http').ServerResponse, value: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(value));
}
export function createDashboard(config: Config, store: Store) {
  return createServer((req, res) => {
    const path = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (path === '/api/summary') return json(res, store.summary());
    if (path === '/api/requests') return json(res, store.list());
    const match = path.match(/^\/api\/requests\/([^/]+)(?:\/(.*))?$/);
    if (match) {
      const id = match[1]!;
      if (!idPattern.test(id)) return json(res, { error: 'Invalid request ID' }, 400);
      const request = store.request(id);
      if (!request) return json(res, { error: 'Request not found' }, 404);
      const suffix = match[2] ?? '';
      if (!suffix) return json(res, { request, blocks: store.blocks(id), events: store.events(id), images: store.images(id) });
      if (suffix === 'diagnostic') return json(res, { request, blocks: store.blocks(id), events: store.events(id), images: store.images(id), note: 'Sanitized metadata only' });
      const imageMatch = suffix.match(/^images\/([a-z0-9_-]+)$/i);
      if (imageMatch) {
        const image = (store.images(id) as { image_id: string; image_path: string }[]).find(item => item.image_id === imageMatch[1]);
        if (!image || !existsSync(image.image_path)) return json(res, { error: 'Image not found' }, 404);
        res.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
        res.end(readFileSync(image.image_path));
        return;
      }
      const blockMatch = suffix.match(/^blocks\/(block_\d+)\/(original|compressed)$/);
      if (blockMatch) {
        const block = (store.blocks(id) as Record<string, unknown>[]).find(item => item.id === blockMatch[1]);
        const artifact = block?.[blockMatch[2] === 'original' ? 'original_path' : 'compressed_path'];
        if (typeof artifact !== 'string' || !existsSync(artifact)) return json(res, { error: 'Artifact not captured' }, 404);
        res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
        res.end(readFileSync(artifact));
        return;
      }
    }
    const asset = path === '/app.js' ? 'app.js' : path === '/style.css' ? 'style.css' : 'index.html';
    res.writeHead(200, { 'content-type': asset.endsWith('.js') ? 'text/javascript; charset=utf-8' : asset.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'" });
    res.end(readFileSync(join(root, asset)));
  });
}
