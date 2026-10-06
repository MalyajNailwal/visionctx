import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Store } from '../packages/storage/index.js';
import { inspectAnthropic } from '../packages/request-inspector/index.js';

test('SQLite migration, usage split, and sensitive artifact withholding', () => {
  const store=new Store(join(mkdtempSync(join(tmpdir(),'visionctx-storage-')),'test.db'),true);
  const id='123e4567-e89b-12d3-a456-426614174000';
  try {
    assert.equal((store.db.prepare('SELECT version FROM schema_migrations').get() as {version:number}).version,1);
    store.received(id,'/v1/messages','passthrough',100);
    const key='sk-ant-abcdefghijklmnopqrstuvwxyz123456';
    const inspected=inspectAnthropic(Buffer.from(JSON.stringify({model:'test',messages:[{role:'user',content:[{type:'tool_result',tool_use_id:'toolu_1',content:`Bearer ${key}`}]}]})),id)!;
    store.parsed(id,inspected.model,false,inspected.blocks);
    assert.equal(store.artifact(id,'block_001','original'),null);
    store.originalCount(id,150);
    store.complete(id,200,42,30,{input_tokens:100,output_tokens:10,cache_read_input_tokens:20,cache_creation_input_tokens:10});
    const request=store.request(id) as {final_tokens:number;original_tokens:number;cache_read_tokens:number;cache_write_tokens:number};
    assert.equal(request.final_tokens,130);
    assert.equal(request.original_tokens,150);
    assert.equal(request.cache_read_tokens,20);
    assert.equal(request.cache_write_tokens,10);
    assert.equal((store.list(1)[0] as {estimated_tokens_saved:number}).estimated_tokens_saved,20);
  } finally { store.close(); }
});
