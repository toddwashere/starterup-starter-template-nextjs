# Archive: Custom pgmq + pg_cron Postgres Image

This directory (`docker/postgres/`) was removed in commit `8bf6a03` that landed
**Task 1.4: Docker Compose — stock Postgres + Redis** (see the
[deploy-profiles spec](../superpowers/specs/2026-05-28-deploy-profiles-design.md)).

The worker queue transport was migrated from **pgmq** (PostgreSQL-backed) to
**BullMQ** (Redis-backed). The custom Postgres image existed solely to bundle
the `pgmq` and `pg_cron` extensions; stock `postgres:16` is now sufficient.

---

## What was in `docker/postgres/`

### `Dockerfile`

Built on `postgres:16` (Debian bookworm). It:

1. Installed **pg_cron 1.6** from the PGDG apt repo (`postgresql-16-cron`).
2. Cloned and compiled **pgmq 1.11.1** from source tag `v1.11.1` via PGXS
   (`pgmq-extension/` Makefile), then purged build deps in the same layer to
   keep the image lean.
3. Appended `shared_preload_libraries = 'pg_cron'` and
   `cron.database_name = 'starter_dev'` to
   `/usr/share/postgresql/postgresql.conf.sample` so pg_cron would load on
   first-init of the data volume.

Key `ARG`: `PGMQ_VERSION=v1.11.1` — bump this to upgrade pgmq.

Verified extension versions:

| Extension | Version |
|-----------|---------|
| pgmq      | 1.11.1  |
| pg_cron   | 1.6     |

### `README.md`

Documented:

- Why `shared_preload_libraries` is required for pg_cron (pg_cron is a
  background worker; without it `CREATE EXTENSION pg_cron` fails).
- Why `cron.database_name = 'starter_dev'` is set (pg_cron's launcher connects
  to exactly one database; default is `postgres`, we need `starter_dev`).
- The "recreate the volume" warning: `postgresql.conf.sample` is only applied
  on **first** volume init, so config changes require destroying the volume.
- Build + verification commands (`docker compose build postgres`,
  `CREATE EXTENSION IF NOT EXISTS pgmq/pg_cron`, `SELECT extname, extversion`).
- Note that `pg_partman` was intentionally **not** installed (only needed for
  partitioned queues; the `jobs` queue was a regular queue).

---

## Why it was removed

The deploy-profiles initiative replaced pgmq with BullMQ so that the queue
transport runs on Redis (portable across all target deploy profiles — GCP Cloud
Run + Memorystore, Render, Vercel + Upstash, AWS, Azure) rather than requiring
PostgreSQL-level extensions that are unavailable on managed Postgres services.

Stock `postgres:16` has no extension requirements; `redis:7-alpine` handles
the queue.
