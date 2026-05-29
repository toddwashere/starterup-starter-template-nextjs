# Worker Queue (pgmq + pg_cron) Implementation Plan

> **Status (2026-05-29):** Superseded by [`2026-05-28-deploy-profiles-design.md`](../specs/2026-05-28-deploy-profiles-design.md). Retained for historical context.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `packages/worker-queue` and `apps/workers` with pgmq + pg_cron as the default background job pipeline, Docker Postgres with extensions for local dev, and a swappable adapter boundary for future BullMQ/SQS.

**Architecture:** Producers call `enqueue(event, payload)`; messages land in pgmq queue `jobs`; `apps/workers` polls, validates Zod payloads, dispatches handlers. pg_cron only enqueues via SQL migrations. See [`docs/superpowers/specs/2026-05-22-worker-queue-pgmq-design.md`](../specs/2026-05-22-worker-queue-pgmq-design.md).

**Tech Stack:** pgmq, pg_cron, `pg`, Zod, Vitest, Docker Compose, TurboRepo, existing `@workspace/email`.

---

## File map

| File / area | Responsibility |
|-------------|----------------|
| `docker/postgres/Dockerfile` | Postgres 16 + pgmq + pg_cron |
| `docker-compose.yml` | Build postgres image; add `workers` service |
| `packages/worker-queue/` | `enqueue`, events registry, adapters |
| `apps/workers/` | Consumer, handlers, health, Dockerfile |
| `packages/database/prisma/migrations/*` | Extension + queue + cron SQL |
| `.env.example` | Worker env vars |
| `turbo.json` / root `package.json` | Include workers in `dev` / `test` |
| `plans/saas-starter-template-plan.md` | Already updated |
| `README.md` | Already updated |

---

## Critical Tests

- `packages/worker-queue/src/events.test.ts`: known events validate payloads; unknown event name rejected at enqueue.
- `packages/worker-queue/src/client.test.ts`: `sync` adapter records publish; malformed payload fails before adapter.
- `packages/worker-queue/src/adapters/pgmq.test.ts`: SQL publish/receive/ack mocked; retry delay passed on nack.
- `apps/workers/src/registry.test.ts`: registry covers all events in `events.ts`; missing handler throws.
- `apps/workers/src/handlers/user-welcome-email.test.ts`: calls email sender once; respects idempotency when implemented.
- `apps/workers/src/consumer.test.ts`: success deletes message; failures retry until max attempts.

---

### Task 1: Docker Postgres with extensions

**Files:**
- Create: `docker/postgres/Dockerfile`
- Create: `docker/postgres/README.md` (build notes, extension versions)
- Modify: `docker-compose.yml`

- [ ] **Step 1:** Research and pin a Postgres 16 base that installs `pgmq` and `pg_cron` (Tembo/pgmq image or multi-stage install from upstream). Document chosen image in `docker/postgres/README.md`.

- [ ] **Step 2:** Update `docker-compose.yml` `postgres` service to `build: docker/postgres` (keep volume, healthcheck, env).

- [ ] **Step 3:** Verify locally: `docker compose up -d postgres`, `docker compose exec postgres psql -U postgres -d starter_dev -c "CREATE EXTENSION IF NOT EXISTS pgmq;"` (and pg_cron) succeed.

- [ ] **Step 4:** Commit: `chore(docker): postgres image with pgmq and pg_cron`

---

### Task 2: SQL migrations for queue and cron

**Files:**
- Create: `packages/database/prisma/migrations/<timestamp>_worker_extensions/migration.sql`

- [ ] **Step 1:** Migration enables `pgmq` and `pg_cron` (idempotent `IF NOT EXISTS`).

- [ ] **Step 2:** Migration creates queue `jobs` via `pgmq.create` (guard if already exists per pgmq API).

- [ ] **Step 3:** Migration schedules `cleanup-expired-sessions` cron → `pgmq.send` with envelope `{"event":"cleanup.expired-sessions","payload":{}}`.

- [ ] **Step 4:** Run `pnpm --filter @workspace/database db:migrate` against Compose postgres; confirm queue and cron job exist.

- [ ] **Step 5:** Commit: `feat(database): pgmq queue and pg_cron cleanup job`

---

### Task 3: `packages/worker-queue` scaffold

**Files:**
- Create: `packages/worker-queue/package.json`, `tsconfig.json`, `eslint.config.mjs`
- Create: `packages/worker-queue/keys.ts`
- Modify: `pnpm-workspace.yaml` (if needed — already `packages/*`)

- [ ] **Step 1:** Add package `@workspace/worker-queue` with exports `.`, `./events`, `./adapters/pgmq` as needed.

- [ ] **Step 2:** Add `keys.ts` Zod env: `WORKER_QUEUE_ADAPTER`, `PGMQ_QUEUE_NAME`.

- [ ] **Step 3:** Wire `type-check` and `test` scripts; add to turbo pipeline.

- [ ] **Step 4:** Commit: `feat(worker-queue): package scaffold`

---

### Task 4: Event registry + envelope (TDD)

**Files:**
- Create: `packages/worker-queue/src/events.ts`
- Create: `packages/worker-queue/src/events.test.ts`
- Create: `packages/worker-queue/src/types.ts`

- [ ] **Step 1:** Write failing tests for `user.welcome-email`, `cleanup.expired-sessions`, `webhook.deliver` payloads and `parseJobEnvelope`.

- [ ] **Step 2:** Implement Zod schemas and `JobEnvelope` type.

- [ ] **Step 3:** Run `pnpm --filter @workspace/worker-queue test`.

- [ ] **Step 4:** Commit: `feat(worker-queue): event registry and envelope`

---

### Task 5: `sync` adapter + `enqueue()` (TDD)

**Files:**
- Create: `packages/worker-queue/src/adapters/sync.ts`
- Create: `packages/worker-queue/src/client.ts`
- Create: `packages/worker-queue/src/resolve-adapter.ts`
- Create: `packages/worker-queue/src/client.test.ts`
- Create: `packages/worker-queue/src/index.ts`

- [ ] **Step 1:** Failing tests: `enqueue` with `WORKER_QUEUE_ADAPTER=sync` validates event and records message.

- [ ] **Step 2:** Implement `QueueAdapter`, `resolveAdapter()`, `enqueue()`.

- [ ] **Step 3:** Tests pass; commit: `feat(worker-queue): enqueue with sync adapter`

---

### Task 6: pgmq adapter (TDD)

**Files:**
- Create: `packages/worker-queue/src/adapters/pgmq.ts`
- Create: `packages/worker-queue/src/adapters/pgmq.test.ts`
- Add dependency: `pg` (or reuse database package pool — prefer minimal `pg` in worker-queue)

- [ ] **Step 1:** Mock `pg` client tests for `publish`, `read`, `delete`/`archive` per pgmq function names from docs.

- [ ] **Step 2:** Implement publish (used by `enqueue`) and export consumer helpers `receive`/`ack`/`nack` for workers.

- [ ] **Step 3:** Integration smoke script optional: `packages/worker-queue/scripts/smoke-pgmq.ts` (manual, not in CI if flaky).

- [ ] **Step 4:** Commit: `feat(worker-queue): pgmq adapter`

---

### Task 7: `apps/workers` scaffold

**Files:**
- Create: `apps/workers/package.json`, `tsconfig.json`, `Dockerfile`
- Create: `apps/workers/src/index.ts`, `health.ts`, `registry.ts`, `consumer.ts`
- Modify: `turbo.json`, root scripts if needed

- [ ] **Step 1:** Package depends on `@workspace/worker-queue`, `@workspace/database` or `pg`, `@workspace/email` (handlers only — keep worker-queue free of email).

- [ ] **Step 2:** Health server on `WORKER_HEALTH_PORT` (default 4300).

- [ ] **Step 3:** Add `dev` script (`tsx watch src/index.ts`); register in turbo `dev`.

- [ ] **Step 4:** Commit: `feat(workers): app scaffold and health endpoint`

---

### Task 8: Handler registry + consumer loop (TDD)

**Files:**
- Create: `apps/workers/src/registry.test.ts`, `consumer.test.ts`
- Modify: `apps/workers/src/registry.ts`, `consumer.ts`

- [ ] **Step 1:** Failing tests for dispatch, retry, max attempts (mocked queue).

- [ ] **Step 2:** Implement poll loop: receive → parse envelope → Zod validate → handler → ack/nack.

- [ ] **Step 3:** Commit: `feat(workers): consumer loop with retries`

---

### Task 9: Handlers v1

**Files:**
- Create: `apps/workers/src/handlers/user-welcome-email.ts` + test
- Create: `apps/workers/src/handlers/cleanup-expired-sessions.ts` + test
- Create: `apps/workers/src/handlers/webhook-deliver.ts` (stub)

- [ ] **Step 1:** `user.welcome-email` — load user by id (Prisma), call `sendWelcomeEmail` from `@workspace/email`.

- [ ] **Step 2:** `cleanup.expired-sessions` — delete expired sessions in batches (Better Auth / Prisma).

- [ ] **Step 3:** `webhook.deliver` — log stub.

- [ ] **Step 4:** Register all in `registry.ts`; tests pass.

- [ ] **Step 5:** Commit: `feat(workers): v1 job handlers`

---

### Task 10: Docker Compose worker service

**Files:**
- Modify: `docker-compose.yml`
- Modify: `.env.example`

- [ ] **Step 1:** Add `workers` service: build `apps/workers`, `DATABASE_URL`, depends on postgres healthy.

- [ ] **Step 2:** Document env vars in `.env.example`.

- [ ] **Step 3:** Manual test: compose up, trigger enqueue (temporary script or server action), see handler log.

- [ ] **Step 4:** Commit: `chore(compose): workers service and env docs`

---

### Task 11: Wire first producer (`user.welcome-email`)

**Files:**
- Modify: chosen signup/post-verify path in `apps/dashboard` or `packages/auth` (app layer only)

- [ ] **Step 1:** After successful signup (or email verification — product choice), `await enqueue("user.welcome-email", { userId })` instead of or in addition to sync send; document behavior when `RESEND_API_KEY` missing.

- [ ] **Step 2:** Add test on server action or auth hook with `WORKER_QUEUE_ADAPTER=sync`.

- [ ] **Step 3:** Commit: `feat(dashboard): enqueue welcome email job`

---

### Task 12: Deploy documentation

**Files:**
- Create: `docs/superpowers/specs/2026-05-22-worker-queue-pgmq-deploy.md` OR section in spec/README

- [ ] **Step 1:** Document Supabase reference steps (extensions, connection strings for worker).

- [ ] **Step 2:** Document generic Docker worker deploy (env list, health check, migrate-before-worker).

- [ ] **Step 3:** Document future BullMQ/SQS adapter env swap (appendix only).

- [ ] **Step 4:** Commit: `docs: worker queue deployment guide`

---

### Task 13: Final verification

- [ ] Run `pnpm type-check`, `pnpm test`, `pnpm lint` at repo root.

- [ ] Run `docker compose up` with postgres + workers; hit health endpoint; run one enqueue smoke test.

- [ ] Update email infrastructure spec cross-link: worker integration in scope (optional one-line in `2026-05-10-email-infrastructure-design.md` out of scope → done).

---

## Notes for implementers

- Do **not** add `schedules.ts` as a TypeScript cron runner.
- Do **not** import `@workspace/email` from `packages/worker-queue`.
- Prisma migrations for extensions may require `prisma migrate` with direct DB URL (not accelerated) — document if issues arise.
- If pgmq Docker build is painful, pin a maintained image hash in `docker/postgres/Dockerfile` and link upstream.
