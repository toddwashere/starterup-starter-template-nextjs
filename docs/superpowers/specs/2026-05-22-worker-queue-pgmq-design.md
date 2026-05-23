# Worker Queue (pgmq + pg_cron) Design

Background job processing for the SaaS starter template: durable queues in PostgreSQL, scheduled triggers via pg_cron, and a host-agnostic worker process. Producers call a single `enqueue()` API; transport is swappable later (BullMQ, SQS) without changing handlers.

## Decisions

| Topic | Decision |
|-------|----------|
| **Default transport** | pgmq extension in PostgreSQL |
| **Scheduling (pgmq profile)** | pg_cron publishes to pgmq via SQL migrations only — no duplicate TypeScript scheduler |
| **Delivery semantics** | **At-least-once**; handlers must be idempotent; optional `idempotencyKey` in job envelope |
| **Production Postgres** | **Supabase documented as reference**; any Postgres with `pgmq` + `pg_cron` supported (BYO) |
| **Worker deployment** | **`apps/workers` Docker image** only — no Fly/Railway/k8s manifests in template |
| **Local development** | **Docker Compose Postgres image with extensions** (not cloud-only dev DB) |
| **Producer API** | `enqueue(eventName, payload, options?)` from `@workspace/worker-queue` — apps never call pgmq SQL directly |
| **Domain packages** | Do not depend on `@workspace/worker-queue`; app layer enqueues after business logic |
| **Email** | Handlers call existing `@workspace/email` senders; auth/dashboard migrate off sync send where appropriate |

## Scope

### In scope

- `packages/worker-queue` — event registry (Zod), `QueueAdapter`, pgmq adapter, `enqueue()`, `sync` adapter for tests
- `apps/workers` — poll loop, handler registry, health HTTP endpoint, Dockerfile
- SQL migrations — enable extensions, create queue, register pg_cron jobs
- `docker/postgres` — Postgres 16 image with `pgmq` and `pg_cron` for Compose
- Compose updates — worker service, documented env vars
- Initial events/handlers: `user.welcome-email`, `cleanup.expired-sessions`, `webhook.deliver` (stub)
- `.env.example` — `WORKER_QUEUE_ADAPTER`, `PGMQ_QUEUE_NAME`, worker ports
- README/plan wording — at-least-once (not “exactly-once”)

### Out of scope

- BullMQ, SQS, pg-boss adapter implementations (interface only; document extension points)
- In-app notifications, notification preferences, unsubscribe
- Stripe billing handlers (enqueue from billing routes is future work)
- Admin UI for failed jobs / DLQ browser
- Provider-specific deploy manifests (ECS, Fly, etc.)
- Multiple queues beyond `jobs` (v1 single queue; namespaced event strings)

## Architecture

### Mental model

“Event-driven” here means **named background jobs with typed payloads**, not a pub/sub bus. All triggers converge on one queue:

```text
Triggers                    Producer layer              Queue (Postgres)           Consumer
────────                    ──────────────              ────────────────           ────────
Server actions      ──┐
Stripe HTTP (later) ──┼──► enqueue(name, payload) ──► pgmq `jobs` ──► apps/workers ──► handler
pg_cron (SQL timer) ──┘     @workspace/worker-queue      at-least-once              registry
```

- **pg_cron** runs only SQL that calls `pgmq.send` — never TypeScript.
- **`apps/workers`** is the only place job logic runs for queued work.
- **Cron schedule source of truth:** SQL migrations under `packages/database/prisma/migrations/` (or dedicated `sql/worker/` if Prisma raw migrations are awkward — prefer one migration pipeline).

### Job envelope

Every message body is JSON validated before handler execution:

```typescript
type JobEnvelope = {
  event: string;           // e.g. "user.welcome-email"
  payload: unknown;        // validated against events registry
  idempotencyKey?: string; // optional dedupe hint for handlers
  enqueuedAt?: string;     // ISO timestamp (set by enqueue)
};
```

pg_cron sends the same shape:

```sql
SELECT pgmq.send(
  'jobs',
  '{"event":"cleanup.expired-sessions","payload":{}}'::text
);
```

### Package layout: `packages/worker-queue`

```
packages/worker-queue/
├── package.json
├── keys.ts                         # WORKER_QUEUE_ADAPTER, PGMQ_QUEUE_NAME, etc.
├── src/
│   ├── index.ts                    # enqueue, re-exports
│   ├── events.ts                   # event name → Zod schema + TypeScript types
│   ├── types.ts                    # JobEnvelope, QueueAdapter, ReceivedMessage
│   ├── client.ts                   # enqueue() → resolve adapter → publish
│   ├── resolve-adapter.ts          # factory from env
│   └── adapters/
│       ├── pgmq.ts                 # default: pgmq SQL via pg client
│       └── sync.ts                 # tests: run handler inline or no-op log
```

**`QueueAdapter` (minimal v1):**

```typescript
interface QueueAdapter {
  publish(queue: string, envelope: JobEnvelope): Promise<string>; // message id
}

// Consumer-only methods live on PgmqConsumer or apps/workers/internal adapter:
// receive, ack, nack — not used by dashboard producers
```

Keep producer surface small. Consumer polling stays in `apps/workers` (can import pgmq adapter internals or a `createPgmqConsumer()` from the same package).

**Dependencies:**

- `@workspace/database` or `pg` for SQL — prefer shared `pg` pool pattern consistent with Prisma’s DB URL; **must not** depend on `@workspace/email`, `@workspace/billing`, or JSX.

### App layout: `apps/workers`

```
apps/workers/
├── Dockerfile
├── package.json
├── src/
│   ├── index.ts                    # start consumer + health server
│   ├── consumer.ts                 # poll loop, retry/backoff, dispatch
│   ├── registry.ts                 # event → handler
│   ├── health.ts                   # GET /health
│   └── handlers/
│       ├── user-welcome-email.ts
│       ├── cleanup-expired-sessions.ts
│       └── webhook-deliver.ts      # stub
```

- Long-lived Node process (`tsx` in dev, compiled `node` in prod).
- Env: `DATABASE_URL`, `WORKER_QUEUE_ADAPTER=pgmq`, `PGMQ_QUEUE_NAME=jobs`, `WORKER_HEALTH_PORT` (default 4300), `WORKER_POLL_INTERVAL_MS`, `WORKER_CONCURRENCY`.
- On handler success: **ack** (delete/archive per pgmq API).
- On failure: **nack** with visibility delay / retry count; after max attempts move to archive/DLQ per pgmq docs.

### Event registry (v1)

| Event | Payload (Zod) | Handler responsibility |
|-------|-----------------|------------------------|
| `user.welcome-email` | `{ userId: string }` | Load user, call `sendWelcomeEmail` or welcome-and-verify per product rules |
| `cleanup.expired-sessions` | `{}` | Delete expired sessions via Better Auth / Prisma (bounded batch) |
| `webhook.deliver` | `{ deliveryId: string }` | Stub: log; real outbound webhooks later |

Add new events by extending `events.ts`, registering handler, and documenting in this table.

### Retry and idempotency

- **Retries:** Consumer tracks attempt count (pgmq read count or app metadata). Exponential backoff via visibility timeout / `nack` delay. Max attempts → archive queue or pgmq dead-letter pattern.
- **Idempotency:** Handlers that must not double-send email check `idempotencyKey` or natural keys (e.g. `userId` + event) in a small `processed_jobs` table (optional v1 — document; implement for `user.welcome-email` if easy).

### Swapping adapters later

| Adapter | Producer change | Scheduler change | Worker change |
|---------|-----------------|------------------|---------------|
| **pgmq** (default) | `WORKER_QUEUE_ADAPTER=pgmq` | pg_cron SQL | Poll Postgres |
| **BullMQ** | env + Redis URL | Repeatable jobs or HTTP tick → `enqueue` | Bull `Worker` |
| **SQS** | env + AWS SDK | EventBridge → SQS | SQS poller |

Handlers and `events.ts` stay unchanged. Document adapter-specific deploy appendices; do not implement BullMQ/SQS in v1.

### `sync` adapter

- `WORKER_QUEUE_ADAPTER=sync` — `enqueue` resolves handler from a test registry or logs only; used in Vitest without Docker extensions.
- Not the default in Compose.

## Database migrations

Run once per environment (dev/staging/prod):

1. `CREATE EXTENSION IF NOT EXISTS pgmq;`
2. `CREATE EXTENSION IF NOT EXISTS pg_cron;`
3. `SELECT pgmq.create('jobs');` (idempotent guard if API supports)
4. `SELECT cron.schedule(...)` for each recurring job

**Do not** add `apps/workers/schedules.ts` as a second scheduler. Optional `packages/worker-queue/src/cron-jobs.ts` may export **constants** (job name, cron expression) referenced in SQL migration comments for DRY documentation only.

### Initial cron job

- `cleanup-expired-sessions` — `0 3 * * *` (daily 03:00 UTC; document timezone assumption)

## Local development (Docker)

Replace or extend `docker-compose.yml`:

- **Service `postgres`:** build `docker/postgres` (Postgres 16 + `pgmq` + `pg_cron`).
- **Service `workers`:** build `apps/workers`, `depends_on: postgres`, same `DATABASE_URL` as apps.
- Document: `pnpm dev` runs dashboard + workers via turbo (add `apps/workers` to turbo `dev` task).

Migrations apply extensions before worker starts; worker should fail fast with clear error if queue missing.

## Deployment (generic)

| Component | Where it runs |
|-----------|----------------|
| pgmq + pg_cron | Inside managed/self-hosted PostgreSQL |
| Producers | Vercel (dashboard), always-on hosts (public-api), etc. |
| `apps/workers` | Any container host — ship **Docker image only** |

**Reference path (documented, not coded):** Supabase — enable extensions in dashboard; use connection string appropriate for long-lived worker (often direct or session pooler, not transaction pooler for polling — verify current Supabase guidance).

**BYO Postgres:** Same SQL migrations; ensure extensions allowed and `DATABASE_URL` reachable from worker container.

**CI/CD order:** migrate DB → deploy apps → deploy worker image (worker can roll independently if handlers are backward compatible).

## Package dependency rules

| Package | Must NOT depend on |
|---------|-------------------|
| `@workspace/worker-queue` | `@workspace/email`, `@workspace/billing` |
| `@workspace/database` | `@workspace/worker-queue` |
| `@workspace/billing` | `@workspace/worker-queue` |

App layer pattern:

```typescript
const user = await createUser(...);
await enqueue("user.welcome-email", { userId: user.id });
```

## Integration with existing email work

- `packages/email` remains synchronous send functions.
- `user.welcome-email` handler imports `@workspace/email` senders.
- Gradually move auth hooks / signup actions from await-send to `enqueue` (separate PR/task in implementation plan).
- Email infrastructure spec “worker queue integration” becomes in scope via this work.

## Environment variables

| Variable | Default | Used by |
|----------|---------|---------|
| `WORKER_QUEUE_ADAPTER` | `pgmq` | worker-queue, workers |
| `PGMQ_QUEUE_NAME` | `jobs` | worker-queue, workers |
| `WORKER_HEALTH_PORT` | `4300` | workers |
| `WORKER_POLL_INTERVAL_MS` | `1000` | workers |
| `WORKER_MAX_ATTEMPTS` | `5` | workers |
| `DATABASE_URL` | (required) | all |

Add to root `.env.example` with comments.

## Critical Tests

- `packages/worker-queue/src/events.test.ts`: registry rejects unknown events; valid payloads parse; envelope shape.
- `packages/worker-queue/src/client.test.ts`: `sync` adapter invokes or records enqueue; invalid event throws before publish.
- `packages/worker-queue/src/adapters/pgmq.test.ts`: publish/receive/ack mocked at SQL boundary (no real extension in unit tests).
- `apps/workers/src/registry.test.ts`: every event in registry has handler; unknown event fails dispatch.
- `apps/workers/src/handlers/user-welcome-email.test.ts`: idempotent / calls email sender with mocked deps.
- `apps/workers/src/consumer.test.ts`: success acks; failure retries until max then archives (mocked adapter).

## Verification (manual)

- Compose up → extensions present → `pgmq` queue `jobs` exists.
- `enqueue` from a dev script or server action → worker logs handler run.
- pg_cron job fires (or manual `pgmq.send` with cron payload) → `cleanup.expired-sessions` runs.
- `GET http://localhost:4300/health` returns 200.

## Plan document updates

- `plans/saas-starter-template-plan.md` — background section aligned with this spec (at-least-once, remove `schedules.ts`, Docker/local/deploy notes).
- `README.md` — background processing bullet: at-least-once; link to spec when implemented.

## References

- [pgmq](https://github.com/pgmq/pgmq)
- [pg_cron](https://github.com/citusdata/pg_cron)
- Supabase pgmq integration (reference deploy path)
- `docs/superpowers/specs/2026-05-10-email-infrastructure-design.md` — email senders consumed by handlers
