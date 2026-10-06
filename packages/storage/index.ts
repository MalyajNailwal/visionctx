import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { initialSql } from './migrations/001_initial.js';
import { redact, sanitize } from '../security/index.js';
import type { ContextBlock, EventStage, RenderedImage } from '../core/types.js';
import { diagnosticArchive, type ArchiveEntry } from './diagnostic.js';

export class Store {
  readonly db: DatabaseSync;
  readonly dataRoot: string;
  private readonly ephemeralArtifacts = new Map<string, string>();
  private ephemeralBytes = 0;
  private readonly maxEphemeralBytes = 16 * 1024 * 1024;
  constructor(path: string, private captureContent: boolean) {
    const absolute = resolve(path);
    mkdirSync(dirname(absolute), { recursive: true, mode: 0o700 });
    this.dataRoot = dirname(absolute);
    this.db = new DatabaseSync(absolute);
    this.db.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    this.db.exec(initialSql);
    this.db.prepare('INSERT OR IGNORE INTO schema_migrations(version) VALUES (1)').run();
  }
  close(): void { this.db.close(); }
  received(id: string, endpoint: string, mode: string, bytes: number): void {
    this.db.prepare(`INSERT INTO requests(id,timestamp,provider,endpoint,input_size,mode) VALUES(?,datetime('now'),'anthropic',?,?,?)`).run(id, redact(endpoint).text, bytes, mode);
    this.event(id, 'REQUEST_RECEIVED');
  }
  event(id: string, stage: EventStage, status = 'ok', metadata: unknown = {}, durationMs: number | null = null): void {
    this.db.prepare('INSERT INTO events(request_id,timestamp,stage,duration_ms,status,metadata_json) VALUES(?,datetime(\'now\'),?,?,?,?)')
      .run(id, stage, durationMs, status, JSON.stringify(sanitize(metadata)));
  }
  parsed(id: string, model: string | null, streaming: boolean, blocks: ContextBlock[], inspectMs: number | null = null): void {
    this.db.prepare('UPDATE requests SET model=?,streaming=? WHERE id=?').run(model, streaming ? 1 : 0, id);
    this.event(id, 'REQUEST_PARSED', 'ok', {}, inspectMs);
    const statement = this.db.prepare(`INSERT INTO context_blocks(request_id,id,path,type,size_bytes,estimated_tokens,compressibility,risk,strategy,reason,sensitive,original_path)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`);
    for (const block of blocks) {
      const cleaned = block.text === null ? { text: '', sensitive: false } : redact(block.text);
      block.sensitive = cleaned.sensitive;
      let originalPath: string | null = null;
      if (!cleaned.sensitive && block.text !== null) this.rememberArtifact(`${id}/${block.id}/original`, cleaned.text);
      if (this.captureContent && !cleaned.sensitive && block.text !== null) originalPath = this.writeArtifact(id, 'original', `${block.id}.txt`, cleaned.text);
      statement.run(id, block.id, block.path, block.type, block.sizeBytes, block.estimatedTokens, block.compressibility,
        block.risk, block.strategy, block.reason, cleaned.sensitive ? 1 : 0, originalPath);
    }
    this.event(id, 'CONTEXT_ANALYZED', 'ok', { block_count: blocks.length });
  }
  compression(id: string, block: ContextBlock, changed: boolean, reason: string, estimatedAfter: number | null, compressedText?: string): void {
    let path: string | null = null;
    if (compressedText && !redact(compressedText).sensitive && !block.sensitive) this.rememberArtifact(`${id}/${block.id}/compressed`, compressedText);
    if (this.captureContent && compressedText && !redact(compressedText).sensitive && !block.sensitive) path = this.writeArtifact(id, 'compressed', `${block.id}.txt`, compressedText);
    this.db.prepare('UPDATE context_blocks SET strategy=?,reason=?,compressed_path=? WHERE request_id=? AND id=?')
      .run(block.strategy, reason, path, id, block.id);
    this.db.prepare('INSERT OR REPLACE INTO compressions(request_id,block_id,strategy,changed,reason,estimated_before,estimated_after) VALUES(?,?,?,?,?,?,?)')
      .run(id, block.id, block.strategy, changed ? 1 : 0, reason, block.estimatedTokens, estimatedAfter);
  }
  image(id: string, block: ContextBlock, image: RenderedImage, page = 0): void {
    if (block.sensitive) throw new Error('Sensitive block cannot be persisted as an image');
    const imageId = `${id}_${block.id}_${page}`;
    const path = this.writeArtifact(id, 'images', `${block.id}_${page}.png`, image.bytes);
    this.db.prepare(`INSERT INTO images(image_id,request_id,context_block_id,source_type,source_size_bytes,image_path,width,height,format,file_size,render_time_ms,estimated_image_tokens)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`).run(imageId,id,block.id,block.type,block.sizeBytes,path,image.width,image.height,'png',image.bytes.length,image.renderTimeMs,image.estimatedImageTokens);
  }
  finalPayload(id: string, payload: unknown): void {
    this.db.prepare('UPDATE requests SET final_payload_json=? WHERE id=?').run(JSON.stringify(sanitize(payload)), id);
    this.event(id, 'FINAL_PAYLOAD');
  }
  originalCount(id: string, tokens: number): void {
    this.db.prepare('UPDATE requests SET original_tokens=? WHERE id=?').run(tokens, id);
    this.db.prepare(`INSERT INTO token_usage(request_id,original_input_tokens,original_source,final_source) VALUES(?,?,'ESTIMATED','ESTIMATED')
      ON CONFLICT(request_id) DO UPDATE SET original_input_tokens=excluded.original_input_tokens,original_source='ESTIMATED'`).run(id, tokens);
  }
  fallback(id: string, reason: string): void {
    this.db.prepare(`UPDATE compressions SET fallback_reason=? WHERE request_id=? AND changed=1`).run(redact(reason).text, id);
    this.db.prepare(`UPDATE context_blocks SET strategy='passthrough',reason=? WHERE request_id=? AND strategy!='passthrough'`).run('Upstream rejected transformed payload; original text sent', id);
    this.event(id, 'FALLBACK_USED', 'error', { reason });
  }
  cost(id: string, pricingVersion: string, finalEstimate: number): void {
    this.db.prepare(`INSERT OR REPLACE INTO cost_records(request_id,pricing_version,final_estimated_cost,source)
      VALUES(?,?,?,'ESTIMATED')`).run(id, pricingVersion, finalEstimate);
  }
  evaluation(id: string, requestId: string, benchmark: string, mode: string, correct: boolean, toolCallCorrect: boolean, metadata: unknown): void {
    this.db.prepare(`INSERT INTO evaluations(id,request_id,benchmark,mode,correctness,tool_call_correct,metadata_json) VALUES(?,?,?,?,?,?,?)`)
      .run(id, requestId, benchmark, mode, correct ? 1 : 0, toolCallCorrect ? 1 : 0, JSON.stringify(sanitize(metadata)));
  }
  evaluations(): unknown[] {
    return this.db.prepare(`SELECT evaluations.*,requests.model,requests.final_tokens,requests.output_tokens,requests.duration_ms,
      (SELECT final_estimated_cost FROM cost_records WHERE cost_records.request_id=requests.id) AS final_estimated_cost
      FROM evaluations LEFT JOIN requests ON requests.id=evaluations.request_id ORDER BY evaluations.rowid DESC`).all();
  }
  complete(id: string, status: number, durationMs: number, outputSize: number, usage?: Record<string, unknown>): void {
    const input = numberOrNull(usage?.input_tokens);
    const output = numberOrNull(usage?.output_tokens);
    const read = numberOrNull(usage?.cache_read_input_tokens);
    const write = numberOrNull(usage?.cache_creation_input_tokens);
    const totalInput = input === null ? null : input + (read ?? 0) + (write ?? 0);
    this.db.prepare(`UPDATE requests SET status=?,duration_ms=?,output_size=?,final_tokens=?,output_tokens=?,cache_read_tokens=?,cache_write_tokens=?,token_source=? WHERE id=?`)
      .run(status,durationMs,outputSize,totalInput,output,read,write,input === null ? 'ESTIMATED' : 'ACTUAL',id);
    this.db.prepare(`INSERT INTO token_usage(request_id,original_source,final_source,final_input_tokens,output_tokens,cached_input_tokens,cache_write_tokens)
      VALUES(?,'ESTIMATED',?,?,?,?,?) ON CONFLICT(request_id) DO UPDATE SET final_source=excluded.final_source,
      final_input_tokens=excluded.final_input_tokens,output_tokens=excluded.output_tokens,cached_input_tokens=excluded.cached_input_tokens,cache_write_tokens=excluded.cache_write_tokens`)
      .run(id,input === null ? 'ESTIMATED' : 'ACTUAL',totalInput,output,read,write);
    this.event(id, 'COMPLETED');
  }
  fail(id: string, message: string): void {
    this.db.prepare('UPDATE requests SET error=? WHERE id=?').run(redact(message).text, id);
    this.event(id, 'FAILED', 'error', { reason: message });
  }
  list(limit = 100): unknown[] { return this.db.prepare(`SELECT requests.*,
    CASE WHEN original_tokens IS NOT NULL AND final_tokens IS NOT NULL THEN original_tokens-final_tokens ELSE NULL END AS estimated_tokens_saved,
    (SELECT COUNT(*) FROM images WHERE images.request_id=requests.id) AS image_count,
    (SELECT GROUP_CONCAT(DISTINCT strategy) FROM context_blocks WHERE context_blocks.request_id=requests.id) AS strategies,
    (SELECT final_estimated_cost FROM cost_records WHERE cost_records.request_id=requests.id) AS final_estimated_cost
    FROM requests ORDER BY timestamp DESC LIMIT ?`).all(limit); }
  request(id: string): unknown { return this.db.prepare(`SELECT requests.*,
    (SELECT final_estimated_cost FROM cost_records WHERE cost_records.request_id=requests.id) AS final_estimated_cost
    FROM requests WHERE id=?`).get(id); }
  blocks(id: string): unknown[] { return this.db.prepare('SELECT * FROM context_blocks WHERE request_id=? ORDER BY id').all(id); }
  events(id: string): unknown[] { return this.db.prepare('SELECT * FROM events WHERE request_id=? ORDER BY id').all(id); }
  images(id: string): unknown[] { return this.db.prepare('SELECT * FROM images WHERE request_id=?').all(id); }
  artifact(id: string, blockId: string, kind: 'original' | 'compressed'): string | null {
    const block = this.db.prepare('SELECT original_path,compressed_path,sensitive FROM context_blocks WHERE request_id=? AND id=?').get(id,blockId) as {original_path:string|null;compressed_path:string|null;sensitive:number}|undefined;
    if (!block || block.sensitive) return null;
    const path = kind === 'original' ? block.original_path : block.compressed_path;
    if (path && existsSync(path)) return readFileSync(path,'utf8');
    return this.ephemeralArtifacts.get(`${id}/${blockId}/${kind}`) ?? null;
  }
  summary(): unknown { return this.db.prepare(`SELECT COUNT(*) requests, SUM(final_tokens) final_tokens,
    SUM(output_tokens) output_tokens, AVG(duration_ms) average_duration_ms,
    SUM(CASE WHEN original_tokens IS NOT NULL AND final_tokens IS NOT NULL THEN original_tokens-final_tokens ELSE NULL END) AS estimated_tokens_saved,
    (SELECT COUNT(*) FROM cost_records) AS priced_requests,
    (SELECT SUM(final_estimated_cost) FROM cost_records) AS final_estimated_cost FROM requests`).get(); }
  diagnostic(id: string): Buffer {
    const request = this.request(id);
    if (!request) throw new Error('Request not found');
    const blocks = this.blocks(id) as {id:string;original_path:string|null;compressed_path:string|null;sensitive:number}[];
    const images = this.images(id) as {image_id:string;image_path:string;context_block_id:string}[];
    const entries: ArchiveEntry[] = [];
    const addJson = (name: string, value: unknown) => entries.push({ name, bytes: Buffer.from(JSON.stringify(sanitize(value ?? null), null, 2)) });
    addJson('metadata.json', {request, blocks, images, events:this.events(id)});
    addJson('final-payload.json', JSON.parse((request as {final_payload_json?:string|null}).final_payload_json || '{}'));
    addJson('metrics.json', this.db.prepare('SELECT * FROM token_usage WHERE request_id=?').get(id));
    for (const block of blocks) {
      if (block.sensitive) continue;
      for (const kind of ['original','compressed'] as const) {
        const text = this.artifact(id,block.id,kind);
        if (text !== null && !redact(text).sensitive) entries.push({name:`${kind}/${block.id}.txt`,bytes:Buffer.from(text)});
      }
    }
    for (const image of images) {
      if (existsSync(image.image_path) && !blocks.find(block=>block.id===image.context_block_id)?.sensitive) {
        entries.push({name:`images/${image.image_id}.png`,bytes:readFileSync(image.image_path)});
      }
    }
    return diagnosticArchive(entries);
  }
  private writeArtifact(id: string, group: string, name: string, content: string | Buffer): string {
    const path = join(this.dataRoot, 'requests', id, group, name);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, content, { mode: 0o600 });
    return path;
  }
  private rememberArtifact(key: string, text: string): void {
    const bytes = Buffer.byteLength(text);
    if (bytes > this.maxEphemeralBytes) return;
    while (this.ephemeralBytes + bytes > this.maxEphemeralBytes && this.ephemeralArtifacts.size) {
      const oldest = this.ephemeralArtifacts.keys().next().value!;
      this.ephemeralBytes -= Buffer.byteLength(this.ephemeralArtifacts.get(oldest)!);
      this.ephemeralArtifacts.delete(oldest);
    }
    this.ephemeralArtifacts.set(key,text);
    this.ephemeralBytes += bytes;
  }
}
function numberOrNull(value: unknown): number | null { return typeof value === 'number' && Number.isFinite(value) ? value : null; }
