# Development

The project uses TypeScript, Node's HTTP server and SQLite, and a native canvas package for PNGs. Run `npm test` after changes. Files under `apps/` are processes and UI; `packages/` contains reusable logic. The source checkout is self-contained and does not write global configuration.

Keep passthrough byte preservation as a hard invariant. Add new providers through protocol adapters. Do not persist secrets or make token/cost claims without provider measurements. Tests use a local mock upstream; an authenticated Anthropic smoke test is a separate release gate.
