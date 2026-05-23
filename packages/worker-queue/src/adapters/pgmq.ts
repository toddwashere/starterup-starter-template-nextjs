import { Pool } from "pg";

import type { JobEnvelope, QueueAdapter, ReceivedMessage } from "../types";

/**
 * Minimal queryable seam so unit tests can mock the SQL boundary without a
 * real database. Both `pg.Pool` and `pg.PoolClient` satisfy this shape.
 */
export interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

/**
 * Lazily-created connection pool. No connection is opened at import time, so
 * producers/tests using the sync adapter never need `DATABASE_URL`. The pool is
 * only constructed on the first query that falls through to it.
 */
let pool: Pool | undefined;

function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error("DATABASE_URL is required for the pgmq adapter");
    }
    pool = new Pool({ connectionString });
  }
  return pool;
}

/** Default visibility timeout (seconds) while a message is being processed. */
const DEFAULT_VISIBILITY_TIMEOUT_SECONDS = 30;
/** Default number of messages to read per poll. */
const DEFAULT_BATCH_SIZE = 1;

export interface ReceiveOptions {
  /** Visibility timeout in seconds while a message is being processed. */
  visibilityTimeoutSeconds?: number;
  /** Max messages to read per poll. */
  batchSize?: number;
}

/**
 * Consumer-facing surface (used by `apps/workers`). Producers only need
 * `QueueAdapter.publish`; workers additionally receive/ack/nack/archive.
 */
export interface PgmqConsumer {
  /** Read up to `batchSize` messages, hiding them for `visibilityTimeoutSeconds`. */
  receive(queue: string, options?: ReceiveOptions): Promise<ReceivedMessage[]>;
  /** Delete a message on successful processing. */
  ack(queue: string, msgId: string): Promise<void>;
  /** Make a message visible again later (retry backoff) by setting its vt. */
  nack(
    queue: string,
    msgId: string,
    options?: { delaySeconds?: number },
  ): Promise<void>;
  /** Move a message to the archive (max-attempts / DLQ path). */
  archive(queue: string, msgId: string): Promise<void>;
}

type SendRow = { msg_id: string | number };
type ReadRow = { msg_id: string | number; read_ct: number; message: unknown };

/**
 * Postgres-backed queue adapter using the pgmq extension. Implements the
 * producer `QueueAdapter` (`publish`) and the `PgmqConsumer` surface.
 */
export class PgmqAdapter implements QueueAdapter, PgmqConsumer {
  constructor(private readonly db?: Queryable) {}

  /** The injected client (tests) or the lazily-created pool (production). */
  private client(): Queryable {
    return this.db ?? getPool();
  }

  async publish(queue: string, envelope: JobEnvelope): Promise<string> {
    const { rows } = await this.client().query(
      "SELECT pgmq.send($1, $2::jsonb) AS msg_id",
      [queue, JSON.stringify(envelope)],
    );
    const row = rows[0] as SendRow;
    return String(row.msg_id);
  }

  async receive(
    queue: string,
    options?: ReceiveOptions,
  ): Promise<ReceivedMessage[]> {
    const { rows } = await this.client().query(
      "SELECT msg_id, read_ct, message FROM pgmq.read($1, $2, $3)",
      [
        queue,
        options?.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY_TIMEOUT_SECONDS,
        options?.batchSize ?? DEFAULT_BATCH_SIZE,
      ],
    );
    // The adapter returns `message` as the envelope WITHOUT re-validating:
    // pg parses jsonb into a JS object. The consumer (a later task) calls
    // `parseJobEnvelope` to validate before dispatching to a handler.
    return (rows as ReadRow[]).map((row) => ({
      msgId: String(row.msg_id),
      readCount: row.read_ct,
      envelope: row.message as JobEnvelope,
    }));
  }

  async ack(queue: string, msgId: string): Promise<void> {
    await this.client().query("SELECT pgmq.delete($1, $2::bigint) AS deleted", [
      queue,
      msgId,
    ]);
  }

  async nack(
    queue: string,
    msgId: string,
    options?: { delaySeconds?: number },
  ): Promise<void> {
    // Setting the visibility timeout delays redelivery -> retry backoff.
    // $3 needs an explicit ::integer cast: pgmq.set_vt is overloaded on the
    // third arg (integer vs timestamptz), so an untyped param is ambiguous.
    await this.client().query(
      "SELECT * FROM pgmq.set_vt($1, $2::bigint, $3::integer)",
      [queue, msgId, options?.delaySeconds ?? 0],
    );
  }

  async archive(queue: string, msgId: string): Promise<void> {
    await this.client().query(
      "SELECT pgmq.archive($1, $2::bigint) AS archived",
      [queue, msgId],
    );
  }
}

/**
 * Construct a pgmq adapter. Pass a `Queryable` to inject a client (tests);
 * omit it to use the lazily-created production pool. Constructing the adapter
 * does NOT open a connection.
 */
export function createPgmqAdapter(db?: Queryable): PgmqAdapter {
  return new PgmqAdapter(db);
}
