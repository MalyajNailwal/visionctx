# Prompt caching

Anthropic hashes a prefix ordered as tools, system, then messages. An image conversion before a cache breakpoint can invalidate that prefix. VisionCtx leaves tools, system, user prompts and recent assistant messages unchanged by default. The dashboard records cache read and write usage if Anthropic returns it. Compression should only be adopted when cache-adjusted cost and task quality improve, not from raw token reduction alone. See [Anthropic prompt caching](https://platform.claude.com/docs/en/build-with-claude/prompt-caching).
