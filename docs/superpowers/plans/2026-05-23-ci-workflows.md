# CI Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add GitHub Actions CI on every PR and push to `main` — lint, type-check, test, build, env validation, and `prisma migrate deploy` against custom Postgres with pgmq + pg_cron.

**Architecture:** Single workflow file runs Turbo tasks monorepo-wide. Postgres starts via `docker build` + `docker run` using `docker/postgres` (not stock `postgres:16`). Database name is `starter_dev` to match `cron.database_name`. Depends on typed-env plan shipping `pnpm validate:env` first.

**Tech Stack:** GitHub Actions, pnpm 11, Turbo, Docker, Prisma migrate deploy, Node 20.

**Design spec:** [`docs/superpowers/specs/2026-05-23-ci-workflows-design.md`](../specs/2026-05-23-ci-workflows-design.md)

**Depends on:** [Typed env validation plan](./2026-05-23-typed-env-validation.md) — `pnpm validate:env` must exist before this plan runs in CI.

---

## File map

| File | Responsibility |
|------|----------------|
| `.github/workflows/ci.yml` | Main CI workflow |
| `turbo.json` | Add missing `globalEnv` entries |
| `README.md` | Branch protection + local CI simulation notes |

---

## Critical Tests

No unit tests for YAML. Manual smoke checklist after merge:

- Clean PR → all CI steps green
- Broken `.env.example` → fails at `validate:env`
- Invalid migration SQL → fails at `migrate deploy`

---

### Task 1: Create CI workflow

**Files:**
- Create: `.github/workflows/ci.yml`

- [ ] **Step 1: Create workflow file**

Create `.github/workflows/ci.yml`:

```yaml
name: CI

on:
  push:
    branches: [main]
  pull_request:

concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true

jobs:
  ci:
    name: Lint, test, build
    runs-on: ubuntu-latest
    timeout-minutes: 30

    env:
      DATABASE_URL: postgresql://postgres:postgres@localhost:5432/starter_dev
      TURBO_TELEMETRY_DISABLED: 1

    steps:
      - name: Checkout
        uses: actions/checkout@v4

      - name: Setup pnpm
        uses: pnpm/action-setup@v4
        with:
          version: 11.1.3

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: pnpm

      - name: Install dependencies
        run: pnpm install --frozen-lockfile

      - name: Validate .env.example
        run: pnpm validate:env

      - name: Lint
        run: pnpm lint

      - name: Type check
        run: pnpm type-check

      - name: Start Postgres (pgmq + pg_cron)
        run: |
          docker build -t starter-postgres:16 docker/postgres
          docker run -d --name postgres \
            -e POSTGRES_USER=postgres \
            -e POSTGRES_PASSWORD=postgres \
            -e POSTGRES_DB=starter_dev \
            -p 5432:5432 \
            starter-postgres:16
          for i in $(seq 1 60); do
            if pg_isready -h localhost -U postgres; then
              echo "Postgres ready"
              exit 0
            fi
            sleep 1
          done
          echo "Postgres failed to start"
          docker logs postgres
          exit 1

      - name: Run database migrations
        run: pnpm --filter @workspace/database exec prisma migrate deploy

      - name: Test
        run: pnpm test

      - name: Build
        run: pnpm build

      - name: Stop Postgres
        if: always()
        run: docker rm -f postgres || true
```

- [ ] **Step 2: Verify YAML locally**

Run: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/ci.yml'))"` (if PyYAML available) or paste into GitHub workflow editor validator.

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add GitHub Actions workflow with custom Postgres"
```

---

### Task 2: Turbo globalEnv updates

**Files:**
- Modify: `turbo.json`

- [ ] **Step 1: Add env vars to `globalEnv`**

Append to `turbo.json` `globalEnv` array (skip any already present):

```json
"BETTER_AUTH_URL",
"NEXT_PUBLIC_BETTER_AUTH_URL",
"NEXT_PUBLIC_DASHBOARD_URL",
"NEXT_PUBLIC_WWW_URL",
"NEXT_PUBLIC_API_URL",
"WORKER_QUEUE_ADAPTER",
"PGMQ_QUEUE_NAME",
"WORKER_HEALTH_PORT",
"WORKER_POLL_INTERVAL_MS",
"WORKER_MAX_ATTEMPTS",
"PUBLIC_API_PORT",
"EMAIL_PREVIEW_PORT"
```

- [ ] **Step 2: Commit**

```bash
git add turbo.json
git commit -m "chore: extend turbo globalEnv for CI cache invalidation"
```

---

### Task 3: Turbo cache (optional local GHA cache)

**Files:**
- Modify: `.github/workflows/ci.yml`

- [ ] **Step 1: Add Turbo cache step** (after checkout, before install)

```yaml
      - name: Cache Turbo
        uses: actions/cache@v4
        with:
          path: .turbo
          key: turbo-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-${{ github.sha }}
          restore-keys: |
            turbo-${{ runner.os }}-${{ hashFiles('pnpm-lock.yaml') }}-
            turbo-${{ runner.os }}-
```

- [ ] **Step 2: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: cache .turbo directory in GitHub Actions"
```

---

### Task 4: README + branch protection docs

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add CI section to README**

Add under a `## CI` heading:

```markdown
## CI

GitHub Actions runs on every pull request and push to `main`:

1. `pnpm validate:env` — validates `.env.example` against typed env schemas
2. `pnpm lint` / `pnpm type-check` / `pnpm test` / `pnpm build`
3. `prisma migrate deploy` against Postgres with **pgmq** and **pg_cron** (custom `docker/postgres` image)

**Local simulation:**

```bash
pnpm validate:env && pnpm lint && pnpm type-check && pnpm test && pnpm build
docker compose up -d postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/starter_dev \
  pnpm --filter @workspace/database exec prisma migrate deploy
```

**Branch protection (recommended):** Require the `CI` / `Lint, test, build` check before merging to `main`.
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "docs: document CI workflow and branch protection"
```

---

### Task 5: Smoke verification

- [ ] **Step 1: Local migrate smoke**

```bash
docker compose up -d postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/starter_dev \
  pnpm --filter @workspace/database exec prisma migrate deploy
```

Expected: all migrations apply including worker extensions

- [ ] **Step 2: Push branch and open PR**

Push to GitHub and confirm workflow runs green on the PR.

- [ ] **Step 3: Smoke checklist**

| Check | Expected |
|-------|----------|
| First CI run on PR | All steps green (~5–10 min with docker build) |
| `validate:env` step | Passes |
| `migrate deploy` step | Passes (pgmq + pg_cron created) |
| `pnpm test` | Passes |
| `pnpm build` | Passes |

---

## Follow-ups (not this plan)

- Publish `starter-postgres:16` to GHCR to skip docker build in CI
- Playwright E2E workflow
- Sentry source map upload (observability follow-up)
- Dependabot / Renovate
- Turbo remote cache
