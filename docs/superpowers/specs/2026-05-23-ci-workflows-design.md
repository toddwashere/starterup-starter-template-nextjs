# CI Workflows Design

**Date:** 2026-05-23  
**Status:** Approved

## Overview

Add GitHub Actions CI that runs on every pull request and push to `main`. v1 runs lint, type-check, test, and build across the monorepo, validates environment configuration, and applies Prisma migrations against a Postgres instance.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **Workflow count** | Single workflow: `.github/workflows/ci.yml` |
| **Triggers** | `pull_request`, `push` to `main` |
| **Postgres image** | Build `docker/postgres` in CI (not stock `postgres:16`) |
| **Database name** | `app_db` — must match `cron.database_name` in custom image |
| **Migrations** | `prisma migrate deploy` before tests |
| **Seed** | No — tests use mocks; seed adds time and flakiness |
| **Playwright E2E** | Out of scope v1 |
| **Sentry source maps** | Out of scope v1 — follow-up tied to observability spec |
| **Turbo remote cache** | Out of scope v1 — local GHA cache on `.turbo` only |
| **GitHub secrets** | None required for v1 CI to pass |

---

## Scope

### In scope

- `.github/workflows/ci.yml`
- Postgres via stock `postgres:16` service container
- Steps: checkout → pnpm install → `validate:env` → lint → type-check → migrate deploy → test → build
- pnpm store cache via `actions/setup-node`
- Turbo local cache on `.turbo`
- `turbo.json` `globalEnv` updates for new vars from typed-env spec
- README note: branch protection should require CI check (documented, not automated)

### Out of scope (v1)

- Matrix builds (multiple Node versions)
- Per-app workflow splits
- Scheduled / nightly runs
- Dependabot config (optional follow-up)
- Playwright job
- Deploy workflows
- Publishing `starter-postgres:16` to GHCR (document as optimization follow-up)

---

## Dependencies

| Spec | Relationship |
|------|--------------|
| [Typed env validation](./2026-05-23-typed-env-validation-design.md) | **Required** — CI runs `pnpm validate:env` |
| [Worker queue pgmq](./done/2026-05-22-worker-queue-pgmq-design.md) | Postgres image and migration requirements |
| [test-utils](./2026-05-23-test-utils-design.md) | Independent — covered by `pnpm test` |
| [Observability Sentry](./2026-05-23-observability-sentry-design.md) | Source map upload in CI is a follow-up |

**Build order:** Implement typed-env spec before or with this spec.

---

## Why not stock Postgres?

The worker extensions migration requires both extensions:

```sql
CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;
```

Stock `postgres:16` images do not include them. Local dev uses `docker/postgres` which:

- Installs `pg_cron` from PGDG apt
- Builds `pgmq` from pinned source tag `v1.11.1`
- Sets `shared_preload_libraries = 'pg_cron'` and `cron.database_name = 'app_db'`

**pg_cron constraint:** `CREATE EXTENSION pg_cron` only succeeds in the database named by `cron.database_name` (`app_db`). CI must **not** use `starter_ci` without changing the Docker image config.

See [`docker/postgres/README.md`](../../../docker/postgres/README.md) for details.

---

## Workflow structure

**File:** `.github/workflows/ci.yml`

**Runner:** `ubuntu-latest`  
**Node:** 24.16.0 (pin explicitly; match repo engines if present)

### Environment

```yaml
env:
  DATABASE_URL: postgresql://postgres:postgres@localhost:5432/app_db
  # Other vars: validate:env loads .env.example defaults; no secrets needed for v1
```

### Steps (in order)

```text
1.  checkout
2.  setup-node (node 24.16.0, cache: pnpm)
3.  corepack enable && pnpm install --frozen-lockfile
4.  pnpm validate:env
5.  pnpm lint
6.  pnpm type-check
7.  Start Postgres (docker build + docker run) — see below
8.  pnpm --filter @workspace/database exec prisma migrate deploy
9.  pnpm test
10. pnpm build
```

GitHub Actions `services:` blocks cannot `docker build`. Postgres is started in a shell step:

```yaml
- name: Start Postgres (pgmq + pg_cron)
  run: |
    docker build -t starter-postgres:16 docker/postgres
    docker run -d --name postgres \
      -e POSTGRES_USER=postgres \
      -e POSTGRES_PASSWORD=postgres \
      -e POSTGRES_DB=app_db \
      -p 5432:5432 \
      starter-postgres:16
    until pg_isready -h localhost -U postgres; do sleep 1; done
```

Allow ~30–60s for first-time image build; subsequent runs benefit from Docker layer cache on the runner when available.

### Migrate deploy

Run from `packages/database` with `DATABASE_URL` pointing at CI Postgres:

```bash
pnpm --filter @workspace/database exec prisma migrate deploy
```

This applies all migrations including `20260522120000_worker_extensions` (pgmq queue + pg_cron schedule).

**Note:** This migration cannot be applied via `prisma migrate dev` (shadow DB + pg_cron). CI correctly uses `migrate deploy`.

### Current test suite

Vitest tests use mocks (e.g. `worker-queue` pgmq adapter tests mock SQL). Postgres in CI primarily proves **migrations apply cleanly** and enables future integration tests. CI should pass with current mocked unit tests.

---

## Caching

| Cache | Mechanism |
|-------|-----------|
| pnpm store | `actions/setup-node` with `cache: pnpm` |
| Turbo | `actions/cache` on `.turbo` keyed by lockfile + branch |

**Follow-up:** Publish `starter-postgres:16` to GHCR on `main` to skip `docker build` on every CI run (~1–2 min savings).

---

## turbo.json updates

Add env vars introduced by typed-env spec to `globalEnv` so Turbo cache invalidates when schemas change. Examples if not already present:

- `BETTER_AUTH_URL`
- `NEXT_PUBLIC_BETTER_AUTH_URL`
- `NEXT_PUBLIC_DASHBOARD_URL`
- `NEXT_PUBLIC_WWW_URL`
- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_MCP_URL`
- `WORKER_HEALTH_PORT`, `WORKER_POLL_INTERVAL_MS`, `WORKER_MAX_ATTEMPTS`

---

## Error handling

| Failure | Behavior |
|---------|----------|
| `validate:env` fails | Job stops before lint; surfaces Zod errors |
| Postgres fails to start | Step retries via `pg_isready` loop; job fails if timeout |
| `migrate deploy` fails | Job fails; tests do not run |
| lint / type-check / test / build fails | Standard Turbo exit code |

---

## Branch protection (documented)

Recommend in README:

- Require status check `ci` (or workflow job name) on PRs to `main`
- No CODEOWNERS in v1

---

## Architecture

```text
GitHub PR / push to main
        │
        ▼
.github/workflows/ci.yml
        │
        ├── pnpm validate:env  ──► .env.example + keys.ts (typed-env spec)
        ├── pnpm lint / type-check / test / build  ──► Turbo monorepo
        │
        └── docker/postgres (app_db)
                 │
                 ▼
            prisma migrate deploy
            (pgmq + pg_cron + schema)
```

---

## Critical Tests

No unit tests for YAML. Verification is manual / CI self-test:

- PR with intentional lint error → CI fails at lint step
- PR with broken `.env.example` (missing required var) → CI fails at `validate:env`
- PR with invalid SQL migration → CI fails at `migrate deploy`
- Clean PR on `main` → all steps green

Implementation plan should include a **smoke checklist** after first CI merge.

---

## Verification

After implementation:

```bash
# Local simulation (approximate)
pnpm validate:env && pnpm lint && pnpm type-check && pnpm test && pnpm build

# With Postgres (matches CI)
docker compose up -d postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_db \
  pnpm --filter @workspace/database exec prisma migrate deploy
```

---

## Follow-ups (not v1)

- GHCR-published `starter-postgres:16` image for faster CI
- Playwright smoke workflow (separate spec) — addressed by [`2026-05-25-dashboard-playwright-e2e-design.md`](./2026-05-25-dashboard-playwright-e2e-design.md)
- Sentry source map upload step (observability spec follow-up)
- Dependabot / Renovate config
- Turbo remote cache (Vercel)
