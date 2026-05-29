# Deploy Profiles & Infrastructure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace pgmq/pg_cron with profile-based queues (BullMQ locally/PaaS, cloud-native on GCP/AWS/Azure), add root `infra/` with README and init wizard, and ship GCP as the reference Pulumi profile — so developers can pick a platform and deploy with minimal env wiring.

**Architecture:** Producers keep `enqueue()` from `@workspace/worker-queue`. Local/Render use BullMQ + Redis with `apps/workers` poll mode; Vercel uses BullMQ + Upstash with HTTP drain routes on dashboard; Pulumi profiles provision managed Postgres + Pub/Sub/SQS/Service Bus + containers. See [`docs/superpowers/specs/2026-05-28-deploy-profiles-design.md`](../specs/2026-05-28-deploy-profiles-design.md).

**Tech Stack:** BullMQ, ioredis (or `@upstash/redis` for serverless), Pulumi (@pulumi/gcp/aws/azure), Docker Compose, Prisma, Vitest, GitHub Actions OIDC.

**Design spec:** [`docs/superpowers/specs/2026-05-28-deploy-profiles-design.md`](../specs/2026-05-28-deploy-profiles-design.md)

---

## File map

| Area | Create / modify |
|------|-----------------|
| `infra/README.md` | Developer entry: profiles, init, deploy, credits, teardown |
| `infra/shared/` | env-manifest, apps.manifest, queue-profiles, CrossGuard policies |
| `infra/gcp/` | Pulumi core + apps stacks (v1 reference) |
| `infra/render/` | `render.yaml` + README |
| `infra/vercel/` | project templates + README |
| `infra/aws/`, `infra/azure/` | Pulumi (after GCP pattern proven) |
| `scripts/infra-init.ts` | Profile wizard |
| `packages/worker-queue/` | Remove pgmq; add bullmq (+ cloud adapters later) |
| `apps/workers/` | BullMQ Worker path, graceful shutdown, `/ready` |
| `apps/dashboard/` | `/api/jobs/drain`, `/api/cron/*`, health routes (Vercel phase) |
| `docker-compose.yml` | Stock postgres + redis |
| `docker/postgres/` | **Delete** (or archive note in README) |
| `packages/database/prisma/migrations/` | Remove `20260522120000_worker_extensions` |
| `.env.example`, `keys.ts` files | `REDIS_URL`, `BULLMQ_QUEUE_NAME`, adapter enum |
| `.github/workflows/ci.yml` | Stock postgres; optional redis service |
| `README.md` | Point to `infra/README.md` |

---

## Critical Tests

- `packages/worker-queue/src/adapters/bullmq.test.ts`: publish adds job with validated envelope; Worker handler acks success; failed job retries until max attempts.
- `packages/worker-queue/src/resolve-adapter.test.ts`: `bullmq` / `sync` selection; throws on unknown adapter.
- `packages/worker-queue/src/client.test.ts`: enqueue validates before publish; uses `BULLMQ_QUEUE_NAME`.
- `apps/workers/src/consumer.test.ts`: `processMessage` idempotency paths unchanged; poison envelope archived.
- `apps/workers/src/graceful-shutdown.test.ts`: draining sets not-ready; in-flight completes within timeout.
- `infra/shared/env-manifest.test.ts`: profile `vercel` wires `NEXT_PUBLIC_*` URLs consistently.
- `infra/shared/queue-profiles.test.ts`: maps profiles to adapter + consumer mode.

---

## Phase 0 — `infra/` skeleton & documentation

### Task 0.1: Create `infra/README.md`

**Files:**
- Create: `infra/README.md`
- Create: `infra/gcp/README.md` (stub: "coming soon")
- Create: `infra/render/README.md` (stub)
- Create: `infra/vercel/README.md` (stub)
- Create: `infra/aws/README.md` (stub)
- Create: `infra/azure/README.md` (stub)

- [ ] **Step 1:** Create `infra/README.md` with sections from spec: profile comparison table, prerequisites, startup credits table (GCP/AWS/Azure/Vercel/Render + Supabase/Upstash), quick start (`pnpm infra:init` placeholder), local dev (`docker compose`), sandbox vs production, teardown, link to design spec.

- [ ] **Step 2:** Add profile stub READMEs pointing back to `infra/README.md`.

- [ ] **Step 3:** Add root `README.md` link under a new **Deploy** section: `See [infra/README.md](infra/README.md)`.

- [ ] **Step 4:** Commit: `docs(infra): add README skeleton and profile stubs`

---

### Task 0.2: Root package scripts (placeholders)

**Files:**
- Modify: `package.json`

- [ ] **Step 1:** Add scripts:

```json
"infra:init": "tsx scripts/infra-init.ts",
"infra:deploy": "echo 'Run profile-specific deploy — see infra/README.md' && exit 1"
```

- [ ] **Step 2:** Create minimal `scripts/infra-init.ts` that prints profile menu and exits 0 (wizard expanded in Phase 2).

- [ ] **Step 3:** Commit: `chore: add infra script placeholders`

---

## Phase 1 — Remove pgmq/pg_cron; add BullMQ (local path)

### Task 1.1: Update env schema

**Files:**
- Modify: `packages/worker-queue/keys.ts`
- Modify: `.env.example`
- Modify: `apps/workers/keys.ts` (if separate)

- [ ] **Step 1:** Replace pgmq keys with:

```typescript
// packages/worker-queue/keys.ts
const schema = z.object({
  WORKER_QUEUE_ADAPTER: z.enum(["bullmq", "sync"]).default("bullmq"),
  BULLMQ_QUEUE_NAME: z.string().default("jobs"),
  REDIS_URL: z.string().url().optional(), // required when adapter is bullmq
});
```

- [ ] **Step 2:** Update `.env.example`: remove `PGMQ_*`, add `REDIS_URL=redis://localhost:6379`, `WORKER_QUEUE_ADAPTER=bullmq`, `BULLMQ_QUEUE_NAME=jobs`.

- [ ] **Step 3:** Run `pnpm validate:env` — fix any `keys.ts` / `.env.example` drift in worker-queue package.

- [ ] **Step 4:** Commit: `feat(worker-queue): bullmq env keys`

---

### Task 1.2: BullMQ adapter (TDD)

**Files:**
- Create: `packages/worker-queue/src/adapters/bullmq.ts`
- Create: `packages/worker-queue/src/adapters/bullmq.test.ts`
- Modify: `packages/worker-queue/package.json` (add `bullmq`, `ioredis`)
- Modify: `packages/worker-queue/src/resolve-adapter.ts`
- Modify: `packages/worker-queue/src/client.ts` (use `BULLMQ_QUEUE_NAME`)
- Modify: `packages/worker-queue/src/index.ts`

- [ ] **Step 1:** Write failing tests in `bullmq.test.ts`:
  - `publish` calls `queue.add` with job name = envelope.event and data = full envelope
  - missing `REDIS_URL` throws clear error

- [ ] **Step 2:** Implement `createBullmqAdapter()`:

```typescript
import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { JobEnvelope, QueueAdapter } from "../types";
import { keys } from "../../keys";

export function createBullmqAdapter(): QueueAdapter {
  const { REDIS_URL } = keys();
  if (!REDIS_URL) throw new Error("REDIS_URL is required for the bullmq adapter");
  const connection = new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
  const queueName = keys().BULLMQ_QUEUE_NAME;
  const queue = new Queue(queueName, { connection });

  return {
    async publish(_queue, envelope: JobEnvelope) {
      const job = await queue.add(envelope.event, envelope, {
        removeOnComplete: true,
        removeOnFail: false,
        attempts: 5,
        backoff: { type: "exponential", delay: 2000 },
      });
      return String(job.id);
    },
  };
}
```

- [ ] **Step 3:** Update `resolve-adapter.ts` to return bullmq adapter; remove pgmq case.

- [ ] **Step 4:** Update `client.ts` to use `keys().BULLMQ_QUEUE_NAME`.

- [ ] **Step 5:** Run `pnpm --filter @workspace/worker-queue test` — all pass.

- [ ] **Step 6:** Commit: `feat(worker-queue): bullmq publish adapter`

---

### Task 1.3: BullMQ Worker in `apps/workers`

**Files:**
- Modify: `apps/workers/package.json` (deps: bullmq, ioredis)
- Modify: `apps/workers/src/index.ts`
- Create: `apps/workers/src/bullmq-worker.ts`
- Modify: `apps/workers/src/consumer.ts` (export `processMessage` for reuse if not already)
- Delete usage of `createPgmqAdapter` in index

- [ ] **Step 1:** Create `bullmq-worker.ts` that starts a BullMQ `Worker` on `BULLMQ_QUEUE_NAME`, maps `job.data` → `ReceivedMessage` shape, calls existing `processMessage` / handler registry.

- [ ] **Step 2:** Replace poll loop in `index.ts`:

```typescript
import { startBullmqWorker } from "./bullmq-worker";
// ...
const stop = await startBullmqWorker({ registry: handlers, config });
// SIGTERM: await stop(); healthServer.close();
```

- [ ] **Step 3:** Manual smoke: with redis + postgres up, enqueue from a test script or existing flow; worker logs job handled.

- [ ] **Step 4:** Commit: `feat(workers): consume jobs via BullMQ Worker`

---

### Task 1.4: Docker Compose — stock Postgres + Redis

**Files:**
- Modify: `docker-compose.yml`
- Delete: `docker/postgres/` (Dockerfile, README) — or move content to `docs/archive/pgmq-postgres-image.md`
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/e2e.yml` (if uses custom postgres image)

- [ ] **Step 1:** Replace `postgres` service:

```yaml
postgres:
  image: postgres:16
  restart: unless-stopped
  ports:
    - "5432:5432"
  environment:
    POSTGRES_USER: postgres
    POSTGRES_PASSWORD: postgres
    POSTGRES_DB: starter_dev
  volumes:
    - postgres_data:/var/lib/postgresql/data
  healthcheck:
    test: ["CMD-SHELL", "pg_isready -U postgres"]
    interval: 5s
    timeout: 3s
    retries: 5

redis:
  image: redis:7-alpine
  restart: unless-stopped
  ports:
    - "6379:6379"
  healthcheck:
    test: ["CMD", "redis-cli", "ping"]
    interval: 5s
    timeout: 3s
    retries: 5
```

- [ ] **Step 2:** Update `workers` service: `WORKER_QUEUE_ADAPTER=bullmq`, `REDIS_URL=redis://redis:6379/0`, `depends_on: [postgres, redis]`.

- [ ] **Step 3:** Update `ci.yml` — remove `docker build docker/postgres`; use `postgres:16` image only.

- [ ] **Step 4:** Verify CI locally: `pnpm validate:env && pnpm test && pnpm build`.

- [ ] **Step 5:** Commit: `chore(docker): stock postgres + redis; drop pgmq image`

---

### Task 1.5: Remove worker extensions migration

**Files:**
- Delete: `packages/database/prisma/migrations/20260522120000_worker_extensions/`
- Create: `packages/worker-queue/src/scheduler/local-cleanup.ts` (or `apps/workers/src/scheduled/register.ts`)
- Modify: `apps/workers/src/index.ts` — register BullMQ repeatable job for `cleanup.expired-sessions`

- [ ] **Step 1:** Delete migration folder `20260522120000_worker_extensions`.

- [ ] **Step 2:** In `bullmq-worker.ts` or startup, add repeatable job:

```typescript
await queue.add(
  "cleanup.expired-sessions",
  { event: "cleanup.expired-sessions", payload: {}, enqueuedAt: new Date().toISOString() },
  { repeat: { pattern: "0 3 * * *" }, jobId: "cleanup-expired-sessions" },
);
```

- [ ] **Step 3:** Document in `infra/README.md` local dev: fresh DBs need `prisma migrate deploy` only (no extension caveats).

- [ ] **Step 4:** Update `docs/superpowers/specs/2026-05-22-worker-queue-pgmq-deploy.md` header: **Superseded by deploy-profiles spec** for production paths.

- [ ] **Step 5:** Remove pgmq adapter files: `packages/worker-queue/src/adapters/pgmq.ts`, `pgmq.test.ts`; update exports.

- [ ] **Step 6:** Commit: `feat(database): remove pgmq/pg_cron migration; bullmq scheduled cleanup`

---

### Task 1.6: Fix downstream references

**Files:**
- Modify: `packages/worker-queue/src/types.ts` (comment: msgId generic)
- Grep and update: README, `.ai/conventions/typed-env.md`, worker deploy guide, CI design docs

- [ ] **Step 1:** `rg pgmq pg_cron PGMQ` — update high-traffic docs (root README, worker-queue package exports).

- [ ] **Step 2:** Run full `pnpm test`, `pnpm lint`, `pnpm type-check`.

- [ ] **Step 3:** Commit: `docs: update references after pgmq removal`

---

## Phase 2 — Shared infra manifests, health, graceful shutdown

### Task 2.1: `infra/shared` manifests

**Files:**
- Create: `infra/shared/package.json` (private, type module) OR plain `.ts` files run via `tsx` — prefer **no package**; use `scripts/` + `infra/shared/*.ts` imported by init script only
- Create: `infra/shared/apps.manifest.ts`
- Create: `infra/shared/queue-profiles.ts`
- Create: `infra/shared/env-manifest.ts`
- Create: `infra/shared/env-manifest.test.ts`
- Create: `infra/shared/queue-profiles.test.ts`

- [ ] **Step 1:** `apps.manifest.ts` — export const `APPS` with name, port, healthPath, dockerfile relative path.

- [ ] **Step 2:** `queue-profiles.ts`:

```typescript
export const QUEUE_PROFILES = {
  local: { adapter: "bullmq", consumerMode: "poll" },
  render: { adapter: "bullmq", consumerMode: "poll" },
  vercel: { adapter: "bullmq", consumerMode: "drain" },
  gcp: { adapter: "pubsub", consumerMode: "poll" },
  aws: { adapter: "sqs", consumerMode: "poll" },
  azure: { adapter: "servicebus", consumerMode: "poll" },
} as const;
```

- [ ] **Step 3:** `env-manifest.ts` — for each profile, list required env vars per app; function `buildEnv(profile, options)` returns Record<string, string> with cross-URL wiring.

- [ ] **Step 4:** Write tests; run via `npx vitest run infra/shared` (add minimal `vitest.config` or colocate tests runnable from root).

- [ ] **Step 5:** Commit: `feat(infra): shared manifests and tests`

---

### Task 2.2: Health + readiness + graceful shutdown

**Files:**
- Modify: `apps/workers/src/health.ts`
- Create: `apps/workers/src/graceful-shutdown.test.ts`
- Modify: `apps/workers/src/bullmq-worker.ts`

- [ ] **Step 1:** Add `let draining = false` module state; export `setDraining(true)` on SIGTERM.

- [ ] **Step 2:** `GET /ready` returns 503 when draining; 200 when DB + redis reachable (lightweight `PING`).

- [ ] **Step 3:** BullMQ worker `close()` on shutdown after current job (use `worker.close()`).

- [ ] **Step 4:** Tests for draining behavior.

- [ ] **Step 5:** Commit: `feat(workers): readiness probe and graceful shutdown`

---

### Task 2.3: Turbo-prune Dockerfiles for Next.js apps

**Files:**
- Create: `infra/shared/docker/Dockerfile.dashboard`
- Create: `infra/shared/docker/Dockerfile.www`
- Create: `infra/shared/docker/Dockerfile.public-api`
- Create: `infra/shared/docker/Dockerfile.public-mcp`
- Modify: `apps/dashboard/next.config.ts`, `apps/www/next.config.ts` — add `output: "standalone"`

- [ ] **Step 1:** Copy pattern from `apps/workers/Dockerfile` — prune `@apps/dashboard`, build standalone, expose 4000.

- [ ] **Step 2:** Add `output: "standalone"` to Next configs.

- [ ] **Step 3:** Local build smoke: `docker build -f infra/shared/docker/Dockerfile.dashboard -t test-dashboard .`

- [ ] **Step 4:** Commit: `feat(infra): standalone Dockerfiles for apps`

---

### Task 2.4: Init wizard v1

**Files:**
- Modify: `scripts/infra-init.ts`

- [ ] **Step 1:** Interactive prompts (readline or `@clack/prompts`): profile, variant (sandbox|production), base domain.

- [ ] **Step 2:** Write `infra/.generated/profile.json` and print next steps from `env-manifest.buildEnv()`.

- [ ] **Step 3:** Add `infra/.generated/` to `.gitignore`.

- [ ] **Step 4:** Commit: `feat(infra): init wizard v1`

---

## Phase 3 — GCP Pulumi (reference profile)

### Task 3.1: Pulumi project scaffold

**Files:**
- Create: `infra/gcp/core/Pulumi.yaml`
- Create: `infra/gcp/core/package.json`
- Create: `infra/gcp/core/tsconfig.json`
- Create: `infra/gcp/core/index.ts`
- Create: `infra/gcp/apps/Pulumi.yaml`
- Create: `infra/gcp/apps/package.json`
- Create: `infra/gcp/apps/index.ts`
- Modify: `infra/gcp/README.md`

- [ ] **Step 1:** `pulumi new gcp-typescript` in `infra/gcp/core` — strip to minimal project + stack config.

- [ ] **Step 2:** Core stack exports: `databaseUrl` (secret), `pubsubTopicName`, `projectId`, `region`.

- [ ] **Step 3:** Apps stack uses `pulumi.StackReference` to read core outputs.

- [ ] **Step 4:** Document: `cd infra/gcp/core && pulumi up -s sandbox`.

- [ ] **Step 5:** Commit: `feat(infra/gcp): pulumi core/apps scaffold`

---

### Task 3.2: GCP sandbox stack resources

**Files:**
- Modify: `infra/gcp/core/index.ts`
- Modify: `infra/gcp/apps/index.ts`
- Create: `infra/shared/policies/gcp-sandbox.ts`

- [ ] **Step 1:** Core sandbox: Cloud SQL Postgres (smallest tier), Pub/Sub topic + DLQ subscription, Secret Manager secret placeholders.

- [ ] **Step 2:** DB resource: `{ protect: true, deleteBeforeReplace: false }` + `deletionProtection: true` on Cloud SQL.

- [ ] **Step 3:** Apps: Cloud Run v2 services for dashboard, www, public-api, public-mcp, workers — `maxInstanceCount: 2`, no LB (use default URLs).

- [ ] **Step 4:** Wire env from manifest; inject `DATABASE_URL` from secret, `WORKER_QUEUE_ADAPTER=pubsub`.

- [ ] **Step 5:** CrossGuard policy file denying `gcp:compute:GlobalForwardingRule` when stack === sandbox.

- [ ] **Step 6:** Commit: `feat(infra/gcp): sandbox Cloud Run + SQL + Pub/Sub`

---

### Task 3.3: GCP deploy workflow

**Files:**
- Create: `.github/workflows/deploy-gcp.yml`

- [ ] **Step 1:** Workflow: paths `infra/gcp/**`, `infra/shared/docker/**`, `apps/**`; OIDC to GCP; build images to Artifact Registry; `pulumi preview` on PR; `pulumi up` on `main` with environment approval for production.

- [ ] **Step 2:** Job order: migrate (`prisma migrate deploy`) → deploy apps → smoke `/health`.

- [ ] **Step 3:** Document billing alert setup in `infra/gcp/README.md`.

- [ ] **Step 4:** Commit: `ci: add deploy-gcp workflow`

---

### Task 3.4: Pub/Sub adapter (worker-queue)

**Files:**
- Create: `packages/worker-queue/src/adapters/pubsub.ts`
- Create: `packages/worker-queue/src/adapters/pubsub.test.ts`
- Modify: `packages/worker-queue/keys.ts`, `resolve-adapter.ts`
- Modify: `apps/workers/src/index.ts` — branch: bullmq vs pubsub poll

- [ ] **Step 1:** TDD publish via `@google-cloud/pubsub`; consumer pull loop in workers (or separate `pubsub-consumer.ts`).

- [ ] **Step 2:** Map Pub/Sub message → `ReceivedMessage`; ack/nack via ack/nack APIs.

- [ ] **Step 3:** Commit: `feat(worker-queue): pubsub adapter for GCP`

---

## Phase 4 — Render profile

### Task 4.1: `render.yaml`

**Files:**
- Create: `infra/render/render.yaml`
- Modify: `infra/render/README.md`

- [ ] **Step 1:** Define services: dashboard, www, public-api, public-mcp (web), workers (worker), postgres, redis.

- [ ] **Step 2:** Env groups from manifest pattern; `WORKER_QUEUE_ADAPTER=bullmq`.

- [ ] **Step 3:** Cron job for cleanup → HTTP or enqueue.

- [ ] **Step 4:** Document startup credits link + 30-day free DB caveat.

- [ ] **Step 5:** Commit: `feat(infra/render): render.yaml blueprint`

---

## Phase 5 — Vercel + Supabase profile

### Task 5.1: Vercel serverless entrypoints

**Files:**
- Create: `apps/public-api/src/vercel.ts` (export fetch handler)
- Modify: `apps/public-mcp/src/index.ts` — split `createFetchHandler()` for Vercel
- Create: `apps/dashboard/app/api/jobs/drain/route.ts`
- Create: `apps/dashboard/app/api/cron/cleanup-expired-sessions/route.ts`
- Create: `apps/dashboard/app/api/health/route.ts`, `apps/dashboard/app/api/ready/route.ts`
- Modify: `infra/vercel/README.md`

- [ ] **Step 1:** Hono Vercel adapter for public-api.

- [ ] **Step 2:** Drain route: process up to N jobs from BullMQ using Upstash connection; protect with `CRON_SECRET` header.

- [ ] **Step 3:** Document 4 Vercel projects + Supabase + Upstash setup; QStash schedule for drain.

- [ ] **Step 4:** Commit: `feat(vercel): drain routes and serverless API entries`

---

## Phase 6 — AWS & Azure (follow GCP pattern)

### Task 6.1: AWS Pulumi

**Files:** `infra/aws/core/`, `infra/aws/apps/`, `.github/workflows/deploy-aws.yml`

- [ ] Mirror GCP structure: RDS, SQS+DLQ, ECS Fargate services, sandbox caps (no NAT/ALB).
- [ ] `packages/worker-queue/src/adapters/sqs.ts` + tests.

### Task 6.2: Azure Pulumi

**Files:** `infra/azure/core/`, `infra/azure/apps/`

- [ ] Container Apps, PostgreSQL Flexible Server, Service Bus.
- [ ] `packages/worker-queue/src/adapters/servicebus.ts` + tests.

---

## Phase 7 — Production hardening

### Task 7.1: GCP production stack variant

- [ ] VPC connector, private Cloud SQL, optional HTTPS LB, canary traffic split, `minInstanceCount` on dashboard only.

### Task 7.2: Infracost + CrossGuard in CI

- [ ] PR comments with cost estimate; policy tests fail on sandbox violations.

### Task 7.3: Archive superseded docs

- [ ] Move `2026-05-22-worker-queue-pgmq-design.md` to `docs/superpowers/specs/done/` per plan-archival convention.

---

## Verification (each phase)

```bash
pnpm validate:env
pnpm lint
pnpm type-check
pnpm test
pnpm build
docker compose up -d
pnpm --filter @workspace/database exec prisma migrate deploy
# enqueue smoke (after Phase 1)
```

---

## Suggested execution order

| Session | Phases | Outcome |
|---------|--------|---------|
| 1 | 0 + 1 | Local dev on BullMQ; pgmq removed; CI green |
| 2 | 2 | Manifests, Dockerfiles, wizard, health |
| 3 | 3 | GCP sandbox deployable |
| 4 | 4 + 5 | Render + Vercel docs/config |
| 5 | 6 + 7 | AWS/Azure + production hardening |

---

## Plan self-review (spec coverage)

| Spec section | Task(s) |
|--------------|---------|
| Kill pgmq/pg_cron | 1.4, 1.5, 1.6 |
| BullMQ local/PaaS | 1.2, 1.3, 4.1, 5.1 |
| Cloud queues | 3.4, 6.1, 6.2 |
| infra/ README + credits | 0.1 |
| Init wizard | 0.2, 2.4 |
| Cost safety / CrossGuard | 3.2 |
| Zero downtime | 2.2, 7.1 |
| Vercel drain | 5.1 |
| Startup credits in README | 0.1 |
| Docker standalone | 2.3 |

No TBD placeholders in task steps above.
