# Claude Code setup

[Claude Code supports `ANTHROPIC_BASE_URL`](https://code.claude.com/docs/en/env-vars) as a gateway override. Start VisionCtx with `npm run start`, then launch a new Claude Code process with `ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude`. Use an API key available to that process; VisionCtx forwards the incoming credential header but does not store it. Run `node dist/apps/cli/index.js doctor` first.

This session-scoped environment variable does not edit Claude Code settings. A non-first-party endpoint may disable MCP tool search by default; consult the current Claude Code docs before forcing it back on. Subscription OAuth routing is not yet verified. Do not read Claude's credential files or inject a token into VisionCtx.

Verification: send a small task, check `visionctx status`, and open the dashboard. A request should show a model, status, events, and actual usage if Anthropic reports it. If the proxy returns 502, check upstream connectivity and API-key routing. If Claude Code bypasses the proxy, check the environment of the process that launched it.
