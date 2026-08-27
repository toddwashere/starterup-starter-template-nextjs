# AI agent guidance

Canonical project instructions for coding agents live in [`.ai/`](./.ai/).

- **Index:** [`.ai/README.md`](./.ai/README.md) — skills and conventions
- **Always-on triggers:** [`.cursor/rules/shared-ai-guidance.mdc`](./.cursor/rules/shared-ai-guidance.mdc) — when to read each skill or convention before editing
- **Secrets:** Never read local secret files such as `.env`; use [`.env.example`](./.env.example) and [`.ai/conventions/secrets-files.md`](./.ai/conventions/secrets-files.md) for environment-variable references.
- **Planning:** New plans/specs under `docs/superpowers/` must include `## Critical Tests` per [`.ai/conventions/critical-tests-in-plans.md`](./.ai/conventions/critical-tests-in-plans.md). Start from [`docs/superpowers/plans/_template.md`](./docs/superpowers/plans/_template.md) or [`docs/superpowers/specs/_template.md`](./docs/superpowers/specs/_template.md).

Do not duplicate long guidance here; add or change content under `.ai/` and register triggers in `shared-ai-guidance.mdc` per [`.ai/conventions/ai-guidance-files.md`](./.ai/conventions/ai-guidance-files.md).

## Cursor Cloud specific instructions

### Services overview

| Service | Port | Start command |
|---------|------|---------------|
| PostgreSQL (pgmq + pg_cron) | 5432 | `docker compose up -d postgres` |
| Dashboard (Next.js) | 4000 | `pnpm exec dotenv -e .env -- pnpm --filter @apps/dashboard dev` |
| Workers (pgmq consumer) | 4300 | `export $(grep -v "^#" .env \| xargs) && pnpm --filter @apps/workers dev` |
| Public API (Hono) | 4002 | `pnpm exec dotenv -e .env -- pnpm --filter @apps/public-api dev` |
| Public MCP | 4003 | `pnpm exec dotenv -e .env -- pnpm --filter @apps/public-mcp dev` |
| WWW (marketing) | 4001 | `pnpm exec dotenv -e .env -- pnpm --filter @apps/www dev` |

### Key startup caveats

- **Docker is required** for PostgreSQL. Start dockerd first: `sudo dockerd &>/tmp/dockerd.log &` then `docker compose up -d postgres`. The custom image (`docker/postgres/Dockerfile`) bundles pgmq + pg_cron extensions.
- **Prisma generate must run before seed/app start.** After `pnpm install`, run `DATABASE_URL="postgresql://postgres:postgres@localhost:5432/starter_dev" pnpm --filter @workspace/database exec prisma generate` to produce the generated client. Without it, imports of `src/generated/prisma/client` fail.
- **Env loading for dev commands**: Individual `pnpm --filter <app> dev` commands do **not** load the root `.env` automatically. Either use `pnpm exec dotenv -e .env --` prefix (works for dashboard/Next.js apps) or `export $(grep -v "^#" .env | xargs)` before running (needed for workers/tsx-based apps since pnpm --filter changes cwd).
- **Migrations**: `DATABASE_URL=... pnpm --filter @workspace/database exec prisma migrate deploy` (set the env inline since dotenv-cli isn't available in that context).
- **Seed credentials**: `user@example.com` / `password123` (regular user, member of org `acme-inc`); `admin@example.com` / `password123` (admin/owner).
- **Stripe keys** are required placeholders (`sk_test_...`, `whsec_...`) for the app to start but real billing flows need real test-mode keys.
- **Standard commands** for lint/test/build/type-check are in the root `package.json` scripts — see README § CI.
