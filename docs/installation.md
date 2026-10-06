# Installation

Requires Node.js 22.13+ and npm. Run `npm install`, `npm run build`, then `npm run start` from the repository root. Copy `.env.example` to `.env` only if you want the CLI to load a local API key. `.env` is ignored by Git. `visionctx.config.yaml` defines loopback ports, storage path, and mode.

The source checkout does not install a global command. Use `node dist/apps/cli/index.js start|stop|status|doctor|dashboard|requests|inspect <id>|config`. `npm run start` is an alias for `start`. API traffic enters on port 8787; the dashboard is on 8788. No configuration is written into Claude Code or OpenCode automatically.

For Docker, export `ANTHROPIC_API_KEY` in the launching shell and run `docker compose up --build`. The Compose file publishes both ports to host loopback only and keeps SQLite data in a named volume. The container config binds internally to `0.0.0.0` so those published ports work. Do not publish the dashboard on a public interface; it has no authentication.
