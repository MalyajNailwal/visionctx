export const initialSql = `
CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS requests (
 id TEXT PRIMARY KEY, timestamp TEXT NOT NULL, provider TEXT NOT NULL, model TEXT, endpoint TEXT NOT NULL,
 duration_ms REAL, status INTEGER, streaming INTEGER NOT NULL DEFAULT 0, input_size INTEGER NOT NULL DEFAULT 0,
 output_size INTEGER NOT NULL DEFAULT 0, mode TEXT NOT NULL, original_tokens INTEGER, final_tokens INTEGER,
 output_tokens INTEGER, cache_read_tokens INTEGER, cache_write_tokens INTEGER, token_source TEXT,
 final_payload_json TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS events (
 id INTEGER PRIMARY KEY AUTOINCREMENT, request_id TEXT NOT NULL, timestamp TEXT NOT NULL, stage TEXT NOT NULL,
 duration_ms REAL, status TEXT NOT NULL, metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS context_blocks (
 request_id TEXT NOT NULL, id TEXT NOT NULL, path TEXT NOT NULL, type TEXT NOT NULL, size_bytes INTEGER NOT NULL,
 estimated_tokens INTEGER NOT NULL, compressibility REAL NOT NULL, risk TEXT NOT NULL, strategy TEXT NOT NULL,
 reason TEXT NOT NULL, sensitive INTEGER NOT NULL, original_path TEXT, compressed_path TEXT,
 PRIMARY KEY(request_id,id)
);
CREATE TABLE IF NOT EXISTS compressions (
 request_id TEXT NOT NULL, block_id TEXT NOT NULL, strategy TEXT NOT NULL, changed INTEGER NOT NULL,
 reason TEXT NOT NULL, estimated_before INTEGER, estimated_after INTEGER, fallback_reason TEXT,
 PRIMARY KEY(request_id,block_id)
);
CREATE TABLE IF NOT EXISTS images (
 image_id TEXT PRIMARY KEY, request_id TEXT NOT NULL, context_block_id TEXT NOT NULL, source_type TEXT NOT NULL,
 source_size_bytes INTEGER NOT NULL, image_path TEXT NOT NULL, width INTEGER NOT NULL, height INTEGER NOT NULL,
 format TEXT NOT NULL, file_size INTEGER NOT NULL, render_time_ms REAL NOT NULL, estimated_image_tokens INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS token_usage (
 request_id TEXT PRIMARY KEY, original_input_tokens INTEGER, compressed_text_tokens INTEGER, estimated_image_tokens INTEGER,
 final_input_tokens INTEGER, output_tokens INTEGER, cached_input_tokens INTEGER, cache_write_tokens INTEGER,
 original_source TEXT NOT NULL, final_source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS cost_records (
 request_id TEXT PRIMARY KEY, pricing_version TEXT, baseline_estimated_cost REAL, final_estimated_cost REAL,
 difference REAL, source TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS evaluations (
 id TEXT PRIMARY KEY, request_id TEXT, benchmark TEXT NOT NULL, mode TEXT NOT NULL, correctness REAL,
 tool_call_correct INTEGER, code_correct INTEGER, metadata_json TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS events_request_idx ON events(request_id,id);
CREATE INDEX IF NOT EXISTS requests_timestamp_idx ON requests(timestamp);
`;
