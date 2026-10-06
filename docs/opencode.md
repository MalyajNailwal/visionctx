# OpenCode setup

[OpenCode supports provider `options.baseURL`](https://opencode.ai/docs/providers). With VisionCtx running, set the **Anthropic provider** base URL in a project-local `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "anthropic": { "options": { "baseURL": "http://127.0.0.1:8787/v1" } }
  }
}
```

Select an Anthropic model and verify that `/v1/messages` requests appear in the dashboard. OpenCode provider SDK behavior may vary by version; this configuration is a documented mechanism, but a live OpenCode integration run has not yet been completed. An OpenAI-compatible custom provider sends a different wire format and is outside this Anthropic-only adapter. Do not point that provider at VisionCtx's Messages endpoint.
