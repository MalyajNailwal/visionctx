# VisionCtx research

Research date: 2026-10-06. This is a design review, not a claim that VisionCtx has measured savings.

## Existing implementations

| Project | Integration | Technique | Lesson for VisionCtx |
| --- | --- | --- | --- |
| [imgctx](https://github.com/NatBrian/image-token-compression) | Anthropic/OpenAI-compatible proxy | Renders selected request regions as PNG pages; retains tool linkage | Reuse the region and profitability-gate ideas, while independently validating image legibility and cost. |
| [pxpipe](https://github.com/xuweizhengo/claude-code-token-compressor) | Anthropic proxy | Selective image conversion, baseline token-count probe, response usage capture | Compare original and final requests on the same call; its documented exact-string misses justify a conservative default. |
| [claude-shorthand](https://github.com/gladehq/claude-shorthand) | Claude Code hook | LLMLingua-2 prompt compression | Hooks can alter tool output before it reaches the model, but do not provide a transparent view of the final Messages payload. |
| [magic-compact](https://github.com/aerovato/magic-compact) | Claude Code/OpenCode plugin | Session compaction | Compaction is complementary to per-request proxy compression; it changes what history the agent sends. |
| [tokenslim](https://github.com/alilfrances/tokenslim) | Claude Code hooks | Deterministic tool-output filtering and deduplication | Prefer safe structural reduction first; its recovery copies also illustrate the privacy risk of storing raw output. |

These projects' savings and quality claims are their own. VisionCtx must reproduce results on its own workloads before reporting any gains.

## Architecture comparison

Hooks work upstream of the API request and can reduce tool output early, but coverage depends on the agent and hook surface. A protocol proxy sees the final request and provider response, can preserve the agent's control flow, and can record actual usage. The proxy is the primary MVP integration. Hooks remain an optional future adapter.

## Integration mechanisms

[Claude Code documents `ANTHROPIC_BASE_URL`](https://code.claude.com/docs/en/env-vars) for a proxy or gateway. A session-scoped invocation can point it at `http://127.0.0.1:8787`; no user settings need changing. [The gateway guide](https://code.claude.com/docs/en/llm-gateway) cautions that gateway compatibility must track new endpoints and headers. A non-first-party host can disable MCP tool search by default; enabling it requires a proxy that forwards `tool_reference` blocks. Subscription OAuth routing is a separate compatibility path and cannot be assumed equivalent to API-key forwarding.

[OpenCode supports provider `options.baseURL`](https://opencode.ai/docs/providers). Its provider SDK determines the wire protocol. VisionCtx's first OpenCode path should use its native Anthropic provider with an Anthropic-compatible base URL; a custom OpenAI-compatible provider would require a separate protocol adapter. Verify actual OpenCode traffic in an integration test before calling this supported.

[Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) uses `POST /v1/messages`; token counting is `POST /v1/messages/count_tokens`. Preserve method, path, query, beta/version/auth headers, request body and status/response bytes in passthrough mode. Unknown routes should proxy conservatively or return a clearly documented unsupported-route response; never silently rewrite them.

## Compression strategies

Passthrough is the correctness baseline. JSON minification is safe only inside text payloads known to be semantically JSON and where exact whitespace is irrelevant. Rule-based text reduction and summarization are lossy; record decisions and evaluate task accuracy. Image conversion is also lossy because model reading is not exact OCR. Leave system instructions, tool schemas, tool IDs, recent turns, cacheable prefixes, exact identifiers, secrets, and source code untouched by default. An adaptive policy should select transformations only after comparing estimated cost and risk, with an override to force passthrough.

## Image rendering approaches

Use a deterministic local renderer with a bundled monospace font or pinned font fallback, measured text layout, explicit line numbers, stable page dimensions, and PNG output. Paginate before model resize, preserve indentation and wrap markers, and record renderer version/options with the artifact. HTML screenshot rendering adds browser weight and layout variability; SVG-to-PNG or canvas can be considered after a small fidelity benchmark. The original text remains the recovery source only if it is safe to persist.

## Image token considerations

[Anthropic vision documentation](https://platform.claude.com/docs/en/build-with-claude/vision) describes image tokens as 28-by-28 pixel patches and model-specific resize limits. Current standard and high-resolution tiers differ, so a single fixed pixel-to-token rule is insufficient for a model-independent cost decision. Server resizing may make small text unreadable. Use the [token-count endpoint](https://platform.claude.com/docs/en/api/messages/count_tokens) for a preflight estimate where available, and compare against response usage after the real request. A local geometric estimate must be labeled `ESTIMATED`.

## Token accounting

Record the original request's token-count result as a counterfactual estimate and the final request's count separately. The provider's response `usage` is actual billing-oriented usage, including cache creation/read where reported. Do not subtract a local text estimate from an actual total and label the result actual savings. Some API-visible usage includes provider formatting not directly visible in the JSON. Output tokens belong to the real response; an A/B task run is required to compare output costs and correctness.

## Prompt caching implications

[Prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching) hashes an exact prefix ordered as tools, system, messages. Images and text changes can invalidate a message prefix, and changing tool definitions invalidates more. Converting a large cached prefix may increase cost despite fewer raw tokens. Keep existing `cache_control` placement and stable prefix bytes intact in the default policy. Report cache read and write tokens from actual usage. Compare cache-adjusted cost, not just raw token counts.

## Tool-call implications

`tool_use` IDs must continue to match `tool_result.tool_use_id`. Tool definitions and structured tool inputs remain native JSON. Candidate text inside a tool result may be replaced only when a valid image content block is allowed at that location. Preserve the order and roles of all messages and never move a tool result into a system prompt. [Anthropic tool-use documentation](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-use-with-prompt-caching) also describes cache interactions.

## Streaming implications

[Anthropic streams SSE events](https://platform.claude.com/docs/en/build-with-claude/streaming), including `message_start`, block events, `message_delta`, pings and `message_stop`. Forward bytes as they arrive, preserve headers/status, and inspect a bounded side-channel copy of event data for usage. A retry is safe only before the upstream has accepted a non-idempotent request or emitted output; normal model POSTs must not be replayed automatically by the proxy.

## Failure modes

Malformed JSON, unsupported request features, model without vision, image validation failures, renderer crashes, huge/slow inputs, disconnected clients, partial SSE, upstream 429/5xx, and token-count failures all need explicit status. A transform failure before sending upstream falls back to original bytes. A transformed request rejected upstream may be retried with original text only when no response bytes reached the client and the retry policy is explicitly enabled. Record both attempts and never claim the transformed request succeeded.

## Security concerns

Run secret detection before writing any artifact or event. A regex scanner is incomplete, so default storage should be metadata-only and opt-in for redacted source snapshots. Never store auth headers, `.env` values, raw base64, credentials, or raw SSE. Keep the dashboard bound to loopback by default and require authentication before remote bind. Sanitize diagnostic bundles and redact nested JSON values, not only text. Filename/path metadata can itself be sensitive. Redaction for the dashboard must not mutate the upstream request in passthrough mode.

## Reuse and improvements

Reuse the proven shape of a loopback proxy, selective gates, deterministic text transformations, and same-call counterfactual token counting. Improve on them with a full request event trail, explicit actual/estimated data labels, cache-adjusted cost, secret-safe storage, exact sanitized final payload inspection, and correctness benchmarks. Do not import another project's code without license review.

## Recommended MVP architecture

1. Transparent byte-preserving Anthropic proxy with SSE and no persistence of content.
2. Metadata/event storage and secret-safe, opt-in redacted diagnostic capture.
3. Anthropic parser/classifier with immutable block references; unsupported blocks pass through.
4. Deterministic minify strategy, followed by an experimental image strategy gated on measured token counts and fidelity.
5. Dashboard consuming a stable read-only inspection API; local benchmark harness and A/B comparisons.

Acceptance must be based on a real API-key or compatible authenticated end-to-end run. This research cannot certify Claude Code subscription compatibility, live image reading accuracy, or cost savings.

Validation update (2026-10-07): Claude Code 2.1.281 completed a one-turn subscription-authenticated passthrough request through VisionCtx. The streamed response and provider usage were captured after handling compressed SSE. This is a smoke test for one installation, not an accuracy or savings benchmark.

A read-only tool-call smoke test was inconclusive: VisionCtx observed tool-use and tool-result blocks, but the run reached its two-turn limit and some Anthropic requests returned HTTP 400. The proxy's mock-upstream tests verify byte-preserving forwarding and tool-link retention; a clean authenticated multi-turn tool run is still required for acceptance.
