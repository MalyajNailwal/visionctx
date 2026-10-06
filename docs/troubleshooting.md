# Troubleshooting

- `doctor` says proxy unreachable: start it with `npm run start` and verify ports 8787/8788 are free.
- Upstream 401: check that the Claude Code or OpenCode process sends a supported Anthropic API key. VisionCtx does not read credentials from disk.
- Upstream 502: check `proxy.upstream`, DNS and network access. The dashboard records a sanitized failure reason.
- Requests absent: verify the agent's base URL is `http://127.0.0.1:8787` and that it uses native Anthropic Messages.
- No original source: content capture is off, or secret detection withheld the block.
- No image: image mode and `compression.image.enabled` must both be set; risk and size gates may still keep text.
- Model misreads image: switch to passthrough, inspect the rendered page, and record an accuracy regression. Images are experimental.
- Image validation error: VisionCtx retries once with original text when a transformed request receives an image-related HTTP 400 before any response reaches the agent; the event timeline records this fallback.
