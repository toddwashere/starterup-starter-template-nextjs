-- Worker queue extensions, queue, and scheduled cleanup job.
--
-- SHADOW DATABASE CAVEAT:
-- pg_cron can only be created in the database named by the cron.database_name
-- server setting (here: starter_dev). Prisma's `migrate dev` validates migrations
-- against a temporary shadow database with a *different* name, so
-- `CREATE EXTENSION pg_cron` fails there. Therefore this migration CANNOT be
-- applied via `prisma migrate dev` / `pnpm db:migrate`.
--
-- Apply it with `prisma migrate deploy` instead (no shadow database), e.g.:
--   pnpm --filter @workspace/database exec dotenv -e ../../.env -- prisma migrate deploy
--
-- (Alternatively, configure a shadowDatabaseUrl whose database is also the
-- cron.database_name, but that is not done here.)
-- See docs/superpowers/specs/2026-05-22-worker-queue-pgmq-design.md.

CREATE EXTENSION IF NOT EXISTS pgmq;
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Create the 'jobs' queue if it does not already exist.
-- pgmq.list_queues() exposes a `queue_name` column; pgmq.create() has no
-- IF NOT EXISTS guard, so we check first to keep this migration idempotent.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pgmq.list_queues() WHERE queue_name = 'jobs') THEN
    PERFORM pgmq.create('jobs');
  END IF;
END $$;

-- Schedule the daily session cleanup. cron.schedule(name, schedule, command)
-- upserts by job name, so re-running this migration is idempotent.
-- 03:00 UTC daily. The command enqueues a job envelope onto the 'jobs' queue.
-- pgmq.send(text, jsonb) returns the message id, so cast the payload to jsonb.
SELECT cron.schedule(
  'cleanup-expired-sessions',
  '0 3 * * *',
  $cron$SELECT pgmq.send('jobs', '{"event":"cleanup.expired-sessions","payload":{}}'::jsonb)$cron$
);
