import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import { createDashboard } from '../apps/dashboard/index.js';
import { gunzipSync } from 'node:zlib';
import { Store } from '../packages/storage/index.js';
import type { Config } from '../packages/core/types.js';
import { inspectAnthropic } from '../packages/request-inspector/index.js';

test('dashboard starts empty and serves request metadata without secrets', async () => {
  const store = new Store(join(mkdtempSync(join(tmpdir(),'visionctx-dashboard-')),'test.db'),false);
  const config = {dashboard:{host:'127.0.0.1',port:8788}} as Config;
  const server = createDashboard(config,store);
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    assert.equal((await (await fetch(`${base}/api/summary`)).json() as {requests:number}).requests,0);
    const page=await (await fetch(base)).text();
    assert.match(page,/CONTEXT OBSERVATORY/);
    store.received('123e4567-e89b-12d3-a456-426614174000','/v1/messages','passthrough',100);
    const inspected=inspectAnthropic(Buffer.from(JSON.stringify({model:'test',messages:[{role:'user',content:'A harmless original string'}]})),'123e4567-e89b-12d3-a456-426614174000')!;
    store.parsed('123e4567-e89b-12d3-a456-426614174000',inspected.model,false,inspected.blocks);
    store.finalPayload('123e4567-e89b-12d3-a456-426614174000',{authorization:'Bearer secret',messages:[{content:'sk-ant-abcdefghijklmnopqrstuvwxyz123456'}]});
    const result=await (await fetch(`${base}/api/requests/123e4567-e89b-12d3-a456-426614174000`)).text();
    assert.doesNotMatch(result,/sk-ant-abcdefghijklmnopqrstuvwxyz123456|Bearer secret/);
    assert.match(result,/REDACTED/);
    const original=await (await fetch(`${base}/api/requests/123e4567-e89b-12d3-a456-426614174000/blocks/block_001/original`)).text();
    assert.equal(original,'A harmless original string');
    const archiveResponse=await fetch(`${base}/api/requests/123e4567-e89b-12d3-a456-426614174000/diagnostic.tar.gz`);
    assert.equal(archiveResponse.headers.get('content-type'),'application/gzip');
    const archive=gunzipSync(Buffer.from(await archiveResponse.arrayBuffer())).toString('utf8');
    assert.match(archive,/metadata.json|final-payload.json/);
    assert.doesNotMatch(archive,/sk-ant-abcdefghijklmnopqrstuvwxyz123456|Bearer secret/);
  } finally { await new Promise<void>(resolve=>server.close(()=>resolve())); store.close(); }
});
