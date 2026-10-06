# Installation

Requires Node.js 22.13+ and npm. Run `npm install`, `npm run build`, then `npm run start` from the repository root. Copy `.env.example` to `.env` only if you want the CLI to load a local API key. `.env` is ignored by Git. `visionctx.config.yaml` defines loopback ports, storage path, and mode.

The source checkout does not install a global command. Use `node dist/apps/cli/index.js start|stop|status|doctor|dashboard|requests|inspect <id>|config`. `npm run start` is an alias for `start`. API traffic enters on port 8787; the dashboard is on 8788. No configuration is written into Claude Code or OpenCode automatically.
