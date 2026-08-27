# AI agent guidance

Canonical project instructions for coding agents live in [`.ai/`](./.ai/).

- **Index:** [`.ai/README.md`](./.ai/README.md) — skills and conventions
- **Always-on triggers:** [`.cursor/rules/shared-ai-guidance.mdc`](./.cursor/rules/shared-ai-guidance.mdc) — when to read each skill or convention before editing
- **Secrets:** Never read local secret files such as `.env`; use [`.env.example`](./.env.example) and [`.ai/conventions/secrets-files.md`](./.ai/conventions/secrets-files.md) for environment-variable references.
- **Planning:** New plans/specs under `docs/superpowers/` must include `## Critical Tests` per [`.ai/conventions/critical-tests-in-plans.md`](./.ai/conventions/critical-tests-in-plans.md). Start from [`docs/superpowers/plans/_template.md`](./docs/superpowers/plans/_template.md) or [`docs/superpowers/specs/_template.md`](./docs/superpowers/specs/_template.md).

Do not duplicate long guidance here; add or change content under `.ai/` and register triggers in `shared-ai-guidance.mdc` per [`.ai/conventions/ai-guidance-files.md`](./.ai/conventions/ai-guidance-files.md).

## Cursor Cloud specific instructions

### Node.js

The repo requires **Node.js ≥ 24.16.0** (see `.nvmrc`). Cloud VMs may ship `/exec-daemon/node` (older Node) ahead of nvm on `PATH`. After `nvm use 24.16.0`, prepend nvm’s bin directory (see `~/.bashrc` in this environment) so `node -v` reports 24.x before running pnpm.

### Docker (Postgres / Redis)

Local development expects **PostgreSQL 16** and optionally **Redis 7** from `docker-compose.yml`. Docker is not started by systemd in this VM profile; if `docker` fails, start the daemon once per session:

```bash
sudo dockerd > /tmp/dockerd.log 2>&1 &
```

`daemon.json` uses `fuse-overlayfs` and `iptables-legacy` (required in nested VMs). Start databases with:

```bash
sudo docker compose up -d postgres redis
```

Wait for Postgres, then run migrations (see below). **Do not** put `docker compose up` in the VM update script.

### Environment and Prisma

Copy `.env.example` → `.env` if missing. Prisma CLI reads `DATABASE_URL` from `.env`; always wrap DB commands:

```bash
pnpm exec dotenv -e .env -- pnpm --filter @workspace/database exec prisma generate
pnpm exec dotenv -e .env -- pnpm --filter @workspace/database exec prisma migrate deploy
pnpm exec dotenv -e .env -- pnpm --filter @workspace/database db:seed
```

Seed credentials: `user@example.com` / `password123`, org slug `acme-inc` (contacts list may be empty — seed creates stages, not sample contacts).

### Verify like CI

With Postgres (and Redis for worker-queue tests) running:

```bash
pnpm validate:env && pnpm lint && pnpm type-check
pnpm test && pnpm build
```

### Running the main app

| Service | Command | URL |
|--------|---------|-----|
| Dashboard (primary product) | `pnpm exec dotenv -e .env -- pnpm --filter @apps/dashboard dev` | http://localhost:4000 |
| All dev apps | `pnpm dev` (Turbo TUI; long-running) | 4000–4004, 4300 |

Health: `GET /api/health` may redirect when unauthenticated; use `/sign-in` or an authenticated session for UI smoke tests.

### Optional services

- **Workers + jobs:** `REDIS_URL` set + `pnpm --filter @apps/workers dev` (or `docker compose up workers`).
- **Public API / MCP / www / email-preview:** see root `README.md` port table; only needed for those surfaces.
