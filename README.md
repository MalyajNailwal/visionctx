# VisionCtx

> Visual context compression and observability for AI coding agents.

VisionCtx is a local Anthropic Messages proxy for Claude Code, OpenCode, and direct API clients. Coding agents accumulate source files, terminal logs, tool results, MCP output, and conversation history. VisionCtx records a request timeline and shows how eligible context was classified and transformed.

```mermaid
flowchart LR
  A[Claude Code / OpenCode / API client] --> P[VisionCtx proxy]
  P --> I[Inspect and classify]
  I --> C[Optional compression]
  C --> U[Anthropic Messages API]
  U --> P --> A
  I --> D[(SQLite metadata)] --> UI[Local dashboard]
```

The default mode is **passthrough**. Image conversion is experimental and disabled by default. No savings are claimed without a real baseline, provider usage, current prices, and task correctness checks.

## Quick start

Requires Node.js 22.13 or newer and an Anthropic API key. The repository is the package; after cloning it:

```bash
npm install
cp .env.example .env
# Put ANTHROPIC_API_KEY in .env, or supply it from your shell.
npm run build
npm run start
```

In a second terminal:

```bash
ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude
```

Open `http://127.0.0.1:8788`, run a coding task, and inspect its request. `node dist/apps/cli/index.js doctor` checks the local proxy and API-key presence without printing credentials. The published package binary is named `visionctx`; in a source checkout, use `node dist/apps/cli/index.js <command>` or `npm run start`.

For OpenCode, use a project-local Anthropic provider `baseURL`; see [OpenCode setup](docs/opencode.md). Direct Anthropic SDK clients may set their base URL to `http://127.0.0.1:8787`.

## What is implemented

- Native Anthropic Messages proxy with POST passthrough, status/header forwarding, SSE streaming, upstream errors, and request IDs.
- Metadata/event capture in SQLite; body capture is off by default.
- Anthropic text and tool-result inspection, safe JSON minification, and experimental PNG conversion for eligible tool-result strings.
- Local dashboard with overview, request explorer, block inspector, sanitized final payload, events, and image previews.
- Tests for passthrough bytes, SSE usage, security, parsing, and PNG output.

## Current limits

- Claude Code subscription OAuth gateway compatibility has not been validated. API-key routing is the supported first path.
- No live Anthropic end-to-end run has been performed in this repository. Local integration tests use a mock upstream.
- Image readability and task accuracy have not been benchmarked, so image mode is off by default.
- Text summarization, learned compression, cost savings, diagnostic archives, and PostgreSQL are not implemented. An optional original-request token-count probe is available for transformed API-key requests. A small A/B harness exists but has not been run against Anthropic here.
- The local renderer depends on the installed platform canvas package and available monospace font. Cross-platform output should be checked before using golden image hashes.

See [research](docs/research.md), [architecture](docs/architecture.md), [installation](docs/installation.md), and [security](docs/security.md).

## Development

```bash
npm test
npx tsc --noEmit
```

The project is MIT licensed. Contributions are welcome; see [CONTRIBUTING.md](CONTRIBUTING.md).
