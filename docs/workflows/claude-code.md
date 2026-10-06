# Claude Code workflow

1. Start VisionCtx with `npm run start`.
2. Run `node dist/apps/cli/index.js doctor`.
3. Launch Claude Code with `ANTHROPIC_BASE_URL=http://127.0.0.1:8787 claude`.
4. Start a coding task. Claude Code sends a Messages request to the local proxy.
5. VisionCtx assigns an ID, inspects the request, and classifies supported text blocks.
6. In passthrough mode it sends the original bytes. Experimental modes may minify safe JSON or render eligible tool-result text as PNG after risk and estimate gates.
7. Anthropic responds. VisionCtx forwards JSON or SSE to Claude Code and records status, timing and provider usage.
8. Open the dashboard on port 8788. Select the request and a block to see its classification, decision, events, sanitized payload and any image.
9. If a transform fails before upstream dispatch, VisionCtx keeps the original text and records a fallback event. For exact-text work, select passthrough.
