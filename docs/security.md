# Security

VisionCtx binds proxy and dashboard to loopback. It never stores request auth headers. Raw request/response bodies are not persisted. Source capture is off by default; when enabled, only blocks with no detected secret pattern are written. Image rendering rejects detected sensitive blocks. Diagnostic views recursively redact common keys and token formats and omit base64 `data` values.

Pattern detection is not a proof of absence of secrets. Keep capture disabled for sensitive workloads. The dashboard has no login; do not expose it through a public reverse proxy. Diagnostic exports currently contain sanitized metadata only. Data files and the database are local; protect backups and filesystem access. In passthrough mode, redaction affects storage/display only, never the upstream body.
