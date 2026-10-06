# Compression

`passthrough` forwards original body bytes. `text` can minify tool-result JSON by parsing and reserializing it. `image` can render eligible tool-result strings when image output is explicitly enabled. `adaptive` uses configured thresholds and conservative risk gates. System prompts, user prompts, assistant messages, source code, secret-bearing blocks, and unsupported content paths stay as text. These modes are experimental except passthrough.

The strategy interface exposes eligibility, token estimate, compression, restoration, and metadata. The original source remains in memory during one request for a pre-dispatch fallback. It is persisted only when capture is opted in and no secret pattern is detected. Compression decisions are visible in the inspector. Image conversion requires task-level A/B evaluation before it can be recommended.
