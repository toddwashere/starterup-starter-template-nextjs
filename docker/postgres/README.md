# Postgres image: pgmq + pg_cron

Custom Postgres 16 image for local development of the worker-queue feature. It
bundles two extensions the queue pipeline depends on:

- **pgmq** — durable message queue (the default transport).
- **pg_cron** — in-database scheduler that enqueues jobs via SQL.

Built and consumed by the `postgres` service in the repo-root `docker-compose.yml`
(`build: docker/postgres`, tagged `starter-postgres:16`).

## Verified versions

| Component | Version |
| --- | --- |
| Base image | `postgres:16` (Debian bookworm); reported `PostgreSQL 16.14 (Debian 16.14-1.pgdg13+1)` |
| pgmq | **1.11.1** (built from source tag `v1.11.1`) |
| pg_cron | **1.6** (installed from PGDG apt: `postgresql-16-cron`) |

`extversion` values confirmed via:

```sql
SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgmq','pg_cron');
--  extname | extversion
-- ---------+------------
--  pgmq    | 1.11.1
--  pg_cron | 1.6
```

## How the extensions are installed

### pg_cron — apt (PGDG)

The official `postgres:16` Debian image already has the PGDG apt source
configured, so pg_cron is a one-line install: `apt-get install -y
postgresql-16-cron`. No compilation needed.

### pgmq — built from source (PGXS)

pgmq is built from the pinned release tag `v1.11.1` using its standard PGXS
Makefile (`pgmq-extension/`):

```sh
git clone --depth 1 --branch v1.11.1 https://github.com/pgmq/pgmq.git
make -C pgmq/pgmq-extension && make -C pgmq/pgmq-extension install
```

The extension version is derived from `default_version` in `pgmq.control`
(`1.11.1`). Build deps (`build-essential`, `git`, `postgresql-server-dev-16`)
are installed and then purged in the same `RUN` layer to keep the image lean.

The pin lives in the Dockerfile as `ARG PGMQ_VERSION=v1.11.1`; bump it there to
upgrade.

**pg_partman is intentionally NOT installed.** pgmq only requires pg_partman for
*partitioned* queues (it raises "pg_partman is required for partitioned queues"
lazily, only when you create one). Our `jobs` queue is a regular queue, so
`CREATE EXTENSION pgmq` and ordinary `pgmq.create()` / `send` / `read` all work
without it. If partitioned queues are needed later, add pg_partman to the image
(its Makefile has an `install-pg-partman` target).

## Required server settings (and why)

pg_cron runs as a background worker that must be loaded at server start, so it
**must** be in `shared_preload_libraries`. The Dockerfile appends these to
`/usr/share/postgresql/postgresql.conf.sample`, which the official entrypoint
copies into `PGDATA` on **first init**:

```conf
shared_preload_libraries = 'pg_cron'
cron.database_name = 'starter_dev'
```

Why each matters:

- `shared_preload_libraries = 'pg_cron'` — without it the library never loads
  and `CREATE EXTENSION pg_cron` fails. (pgmq needs no preload.)
- `cron.database_name = 'starter_dev'` — pg_cron's launcher connects to exactly
  one database (default `postgres`). We point it at our app DB, `starter_dev`.
  A consequence: the pg_cron extension can only be created **in `starter_dev`**
  (`CREATE EXTENSION pg_cron` run in any other DB will error). That is why the
  verification and the SQL migrations target `-d starter_dev`.

Note: on first init the logs show a brief, harmless `database "starter_dev" does
not exist` + `pg_cron launcher exited` during the bootstrap phase, before the
entrypoint creates `starter_dev` and does its final restart. The final log line
`pg_cron scheduler started` confirms it is healthy.

## IMPORTANT: recreate the volume when these settings change

`postgresql.conf.sample` is only copied into `PGDATA` on the **first**
initialization of a data volume. If you change the preload/cron settings (or
you have a pre-existing `*_postgres_data` volume from the old `postgres:16-alpine`
image), an existing volume will **not** pick up the new config and pg_cron will
not preload.

To apply the settings cleanly you must recreate the data volume — **this
destroys local dev data**, which is acceptable for this dev-only image:

```sh
docker compose down
# confirm the exact name first; it is <compose-project>_postgres_data
docker volume ls | grep postgres_data
docker volume rm <compose-project>_postgres_data
docker compose up -d --build postgres
```

## Build and verify

```sh
docker compose build postgres
docker compose up -d postgres

# wait until ready
until docker compose exec -T postgres pg_isready -U postgres; do sleep 1; done

# both must succeed (pg_cron succeeding proves shared_preload_libraries worked)
docker compose exec -T postgres psql -U postgres -d starter_dev \
  -c "CREATE EXTENSION IF NOT EXISTS pgmq;"
docker compose exec -T postgres psql -U postgres -d starter_dev \
  -c "CREATE EXTENSION IF NOT EXISTS pg_cron;"

# confirm versions
docker compose exec -T postgres psql -U postgres -d starter_dev \
  -c "SELECT extname, extversion FROM pg_extension WHERE extname IN ('pgmq','pg_cron');"
```
