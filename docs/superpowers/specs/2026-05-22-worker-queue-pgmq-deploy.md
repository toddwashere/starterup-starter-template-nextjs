# Worker Queue (pgmq + pg_cron) Deployment

How to deploy the background worker queue: the extension-enabled PostgreSQL, the
database migration, and the long-lived `apps/workers` process. For the design
rationale see [the design spec](./2026-05-22-worker-queue-pgmq-design.md); for the
build steps see [the implementation plan](../plans/2026-05-22-worker-queue-pgmq.md).

Delivery is **at-least-once**: the queue may hand the same message to a handler
more than once (worker restart mid-job, visibility-timeout expiry, redelivery on
crash). Every handler **must be idempotent** — re-running it with the same
payload must not double-charge, double-send, or corrupt state. The worker is
otherwise stateless: it holds no local job state, so multiple instances can run
side by side.

## Architecture recap

```text
Producers                 Queue (Postgres)        Worker
─────────                 ────────────────        ──────
enqueue(event, payload) ─► pgmq `jobs` ──► apps/workers poll loop
@workspace/worker-queue        ▲                │
                               │                ├─ validate Zod envelope
pg_cron (SQL timer) ───────────┘                ├─ dispatch to handler
                                                └─ ack (delete) / nack (retry) / archive (DLQ)
```

- **Producers** call `enqueue(event, payload)` from `@workspace/worker-queue`;
  the message lands in the pgmq queue named `jobs`.
- **pg_cron** enqueues scheduled jobs with plain SQL — there is no TypeScript
  scheduler.
- **`apps/workers`** polls `jobs`, validates the envelope, dispatches to a
  handler, then acks on success or nacks/archives on failure.

## Prerequisites

| Requirement | Notes |
|-------------|-------|
| PostgreSQL with `pgmq` | Durable message queue; the default transport. |
| PostgreSQL with `pg_cron` | In-database scheduler that enqueues jobs via SQL. |
| `shared_preload_libraries = 'pg_cron'` | pg_cron is a background worker loaded at server start. Without the preload, `CREATE EXTENSION pg_cron` fails. (pgmq needs no preload.) |
| `cron.database_name = <app DB>` | pg_cron's launcher connects to exactly one database. The extension can only be created **in that database**; running `CREATE EXTENSION pg_cron` elsewhere errors. |
| `DATABASE_URL` reachable from the worker | The worker container must be able to open a long-lived connection to Postgres. |

The local dev image (`docker/postgres/Dockerfile`) is Postgres 16 with pgmq
1.11.1 (built from source) and pg_cron 1.6 (PGDG apt). It sets
`cron.database_name = 'starter_dev'`. See
[`docker/postgres/README.md`](../../../docker/postgres/README.md) for build,
verification, and the volume-recreation caveat when these server settings change.

For bring-your-own (BYO) Postgres, ensure the host allows both extensions, sets
the two server settings above, and that the cron database matches the database
your migration targets.

## Database migration

The Prisma migration
`packages/database/prisma/migrations/20260522120000_worker_extensions/` does
three things:

1. `CREATE EXTENSION IF NOT EXISTS pgmq;` and `CREATE EXTENSION IF NOT EXISTS pg_cron;`
2. Creates the `jobs` queue (idempotent — guarded with `pgmq.list_queues()`).
3. Schedules the `cleanup-expired-sessions` cron job (`0 3 * * *`, **03:00 UTC**)
   which enqueues `{"event":"cleanup.expired-sessions","payload":{}}` onto `jobs`.

### Apply with `migrate deploy`, not `migrate dev`

> **Gotcha:** this migration **cannot** be applied with `prisma migrate dev`
> (or `pnpm db:migrate`). `migrate dev` validates migrations against a temporary
> **shadow database** whose name differs from `cron.database_name`, so
> `CREATE EXTENSION pg_cron` fails there.

Apply it with `prisma migrate deploy`, which has no shadow database:

```sh
pnpm --filter @workspace/database exec dotenv -e ../../.env -- prisma migrate deploy
```

Or run `prisma migrate deploy` directly with the production `DATABASE_URL`
pointed at the cron database.

### CI/CD ordering

Apply the migration **before** the worker runs:

```text
1. migrate DB          (prisma migrate deploy)
2. deploy producers    (dashboard, public-api, etc.)
3. deploy / restart the worker (apps/workers)
```

The worker fails fast if the `jobs` queue does not exist yet; its container
restart policy will keep restarting it until step 1 has created the queue.
Because handlers are backward compatible and the worker is stateless, it can
roll independently of producers.

## Supabase (reference path)

Supabase is documented as a **reference** deployment target — exact UI labels and
steps change over time, so treat this as a starting point and verify against
[current Supabase docs](https://supabase.com/docs/guides/database/extensions).

1. **Enable the extensions.** In the Supabase Dashboard go to
   **Database → Extensions** and enable `pgmq` and `pg_cron`. Both are
   supported managed extensions; pg_cron is enabled per Supabase's documentation.
2. **Target the right database.** On Supabase, `cron.database_name` is
   `postgres` (not `starter_dev`). Create the queue and cron job in the
   `postgres` database. If you run the Prisma migration, point its
   `DATABASE_URL` at that database so `CREATE EXTENSION pg_cron` and the
   `cron.schedule(...)` call land where pg_cron's launcher is connected.
3. **Connection string for the worker.** The worker is a **long-lived** process
   that holds a persistent polling connection. Use a **direct / session-mode**
   connection string, **not** a transaction-mode pooler — transaction pooling is
   designed for short, stateless queries and is a poor fit for a process that
   keeps a connection open and uses session features. Verify the current
   recommended connection string in the Supabase project settings.

## Generic Docker worker deploy

The worker ships as a Docker image only (no Fly/Railway/k8s manifests in the
template). Any container host that can run the image and reach Postgres works.

### Build the image

The Dockerfile is `apps/workers/Dockerfile`. It is a multi-stage Turborepo-prune
build on `node:22-slim`: it prunes the monorepo to `@apps/workers` and its
workspace dependencies, installs the pruned dependency set with a frozen
lockfile, runs `prisma generate`, and starts the worker via `tsx src/index.ts`
(the workspace packages export their `.ts` source, so there is no compiled-JS
step).

> **The build context must be the repo ROOT**, not `apps/workers/`, because the
> prune step needs the whole workspace and lockfile:

```sh
docker build -f apps/workers/Dockerfile -t starter-workers .
```

### Required environment variables

| Variable | Default | Purpose |
|----------|---------|---------|
| `DATABASE_URL` | (required) | Postgres connection string. Must be reachable from the worker container and point at the database where the `jobs` queue lives. In docker-compose use the compose service name (e.g. `postgresql://postgres:postgres@postgres:5432/starter_dev`) — **not** `localhost`, which inside a container refers to the container itself. |
| `WORKER_QUEUE_ADAPTER` | `pgmq` | Transport adapter. `sync` is for tests only; production uses `pgmq`. |
| `PGMQ_QUEUE_NAME` | `jobs` | Name of the pgmq queue to poll. Must match the queue created by the migration. |
| `WORKER_HEALTH_PORT` | `4300` | Port for the health HTTP endpoint. |
| `WORKER_POLL_INTERVAL_MS` | `1000` | How often the poll loop checks for new messages. |
| `WORKER_MAX_ATTEMPTS` | `5` | After this many delivery attempts a failing message is archived (pgmq archive = dead-letter store). |
| `RESEND_API_KEY` | (optional) | Resend API key for email handlers. Without it, email handlers just log. |
| `EMAIL_FROM` | (optional) | From address for outbound email. |

### Health check

The worker exposes a health endpoint:

```text
GET /health  →  200 {"status":"ok"}    (on WORKER_HEALTH_PORT, default 4300)
```

Wire this into your platform's container health check / readiness probe.

### Ordering and scaling

- **Migrate before the worker.** Run `prisma migrate deploy` (which creates the
  `jobs` queue) before starting or restarting the worker, per the
  [CI/CD ordering](#cicd-ordering) above.
- **Scale horizontally.** The worker is stateless. Because delivery is
  at-least-once and handlers are idempotent, you can run multiple worker
  instances safely — pgmq's visibility timeout keeps a message hidden from other
  workers while one is processing it.

### Retries and dead-lettering

- On `nack`, the consumer extends the message's pgmq visibility timeout
  (`set_vt`) to implement exponential backoff before the next attempt.
- After `WORKER_MAX_ATTEMPTS` failed deliveries the message is `archive`d. The
  pgmq archive table acts as the dead-letter store.
- A **poison message** (envelope fails Zod validation) is archived immediately,
  not retried.

## Local development

The repo-root `docker-compose.yml` brings up the extension-enabled Postgres and
the worker together:

```sh
docker compose up
```

Then, from the host:

```sh
# 1. Apply the migration (creates extensions, the `jobs` queue, and the cron job).
pnpm --filter @workspace/database exec dotenv -e ../../.env -- prisma migrate deploy

# 2. Enqueue a job (via a dev script / server action that calls enqueue(),
#    or a manual pgmq.send for a quick smoke test):
docker compose exec -T postgres psql -U postgres -d starter_dev \
  -c "SELECT pgmq.send('jobs', '{\"event\":\"cleanup.expired-sessions\",\"payload\":{}}'::jsonb);"

# 3. Watch the worker pick it up.
docker compose logs -f workers

# 4. Confirm the health endpoint.
curl http://localhost:4300/health   # -> {"status":"ok"}
```

See [`docker/postgres/README.md`](../../../docker/postgres/README.md) for the
Postgres image details, version verification, and the note about recreating the
data volume when the preload/cron server settings change.

## Appendix: swapping the transport (BullMQ / SQS)

**Documentation only — not implemented.** The template ships the pgmq adapter.
BullMQ and SQS are described here as future extension points so the seams are
clear.

What stays the same when you swap transports:

- **Handlers** (`apps/workers/src/handlers/`) — unchanged.
- **The event registry** (`events.ts`) — unchanged; event names and Zod payload
  schemas are transport-agnostic.

What changes: the **queue adapter**, the **scheduler**, and the **worker poller**.

| Adapter | Producer / env | Scheduler | Worker |
|---------|----------------|-----------|--------|
| **pgmq** (default) | `WORKER_QUEUE_ADAPTER=pgmq` | pg_cron SQL | Poll Postgres |
| **BullMQ** | env + Redis URL | Repeatable jobs or HTTP tick → `enqueue` | Bull `Worker` |
| **SQS** | env + AWS SDK | EventBridge → SQS | SQS poller |

Each new adapter implements the same `QueueAdapter` interface and is selected
via `WORKER_QUEUE_ADAPTER`. Adding one does not touch business logic — only the
adapter, scheduler, and poll loop.

## References

- [Worker queue design spec](./2026-05-22-worker-queue-pgmq-design.md)
- [Worker queue implementation plan](../plans/2026-05-22-worker-queue-pgmq.md)
- [`docker/postgres/README.md`](../../../docker/postgres/README.md) — Postgres image with pgmq + pg_cron
- [pgmq](https://github.com/pgmq/pgmq)
- [pg_cron](https://github.com/citusdata/pg_cron)
- [Supabase database extensions](https://supabase.com/docs/guides/database/extensions)
