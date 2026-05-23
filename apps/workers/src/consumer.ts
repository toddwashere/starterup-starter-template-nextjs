import {
  parseJobEnvelope,
  type EventName,
  type PgmqConsumer,
  type ReceivedMessage,
  type ReceiveOptions,
} from "@workspace/worker-queue";

import { getHandler, type HandlerRegistry } from "./registry";

/** Base backoff in seconds for the first retry. */
const BASE_BACKOFF_SECONDS = 2;
/** Upper bound on retry backoff so it never grows without limit. */
const MAX_BACKOFF_SECONDS = 300;

export interface ConsumerConfig {
  queue: string;
  /** Give up (archive) once readCount reaches this. From WORKER_MAX_ATTEMPTS. */
  maxAttempts: number;
  /** Delay between empty polls. From WORKER_POLL_INTERVAL_MS. */
  pollIntervalMs: number;
  receiveOptions?: ReceiveOptions;
}

export interface ConsumerDeps {
  adapter: PgmqConsumer;
  registry: HandlerRegistry;
  config: ConsumerConfig;
}

/**
 * Exponential backoff (seconds) for retry #attempt (pgmq read_ct), capped at
 * MAX_BACKOFF_SECONDS. attempt is 1-based: the first retry uses BASE.
 */
export function computeBackoffSeconds(attempt: number): number {
  const backoff = BASE_BACKOFF_SECONDS * 2 ** (attempt - 1);
  return Math.min(backoff, MAX_BACKOFF_SECONDS);
}

/**
 * Process ONE message: parse/validate -> dispatch -> ack / nack / archive.
 * Never throws: a single bad message must not kill the poll loop.
 */
export async function processMessage(
  deps: ConsumerDeps,
  message: ReceivedMessage,
): Promise<void> {
  const { adapter, registry, config } = deps;
  const { queue, maxAttempts } = config;

  // 1. Parse/validate. A failure here is a poison message that can never
  //    succeed -> archive it (do NOT call a handler).
  let envelope;
  try {
    envelope = parseJobEnvelope(message.envelope);
  } catch (error) {
    console.error(
      `[workers] poison message ${message.msgId}; archiving`,
      error,
    );
    await adapter.archive(queue, message.msgId);
    return;
  }

  // 2. Dispatch to the registered handler with the validated payload.
  try {
    const handler = getHandler(registry, envelope.event as EventName);
    await handler(envelope.payload as never);
  } catch (error) {
    // 4. Handler threw: retry with backoff, or give up at maxAttempts.
    if (message.readCount >= maxAttempts) {
      console.error(
        `[workers] message ${message.msgId} failed at attempt ` +
          `${message.readCount}/${maxAttempts}; archiving`,
        error,
      );
      await adapter.archive(queue, message.msgId);
    } else {
      const delaySeconds = computeBackoffSeconds(message.readCount);
      console.error(
        `[workers] message ${message.msgId} failed at attempt ` +
          `${message.readCount}/${maxAttempts}; retrying in ${delaySeconds}s`,
        error,
      );
      await adapter.nack(queue, message.msgId, { delaySeconds });
    }
    return;
  }

  // 3. Success.
  await adapter.ack(queue, message.msgId);
}

/** Receive a batch and process each message; returns the count processed. */
export async function pollOnce(deps: ConsumerDeps): Promise<number> {
  const { adapter, config } = deps;
  const messages = await adapter.receive(config.queue, config.receiveOptions);
  for (const message of messages) {
    await processMessage(deps, message);
  }
  return messages.length;
}

/** Sleep `ms`, resolving early if `signal` aborts. Cleans up its own timer. */
function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => {
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Long-running poll loop until `signal` aborts. The per-message logic in
 * processMessage/pollOnce is what carries correctness; this stays thin.
 */
export async function startConsumer(
  deps: ConsumerDeps,
  signal?: AbortSignal,
): Promise<void> {
  while (!signal?.aborted) {
    await pollOnce(deps);
    if (signal?.aborted) {
      break;
    }
    await sleep(deps.config.pollIntervalMs, signal);
  }
}
