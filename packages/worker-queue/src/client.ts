import { keys } from "../keys";

import {
  type EventName,
  type EventPayload,
  parseEventPayload,
} from "./events";
import { resolveAdapter } from "./resolve-adapter";
import type { JobEnvelope } from "./types";

/**
 * Producer API: validate `payload` against the events registry, then publish a
 * job envelope onto the configured queue.
 *
 * The payload is validated FIRST, so a malformed payload (or unknown event)
 * throws before any adapter is resolved or contacted.
 *
 * @returns the adapter-generated message id.
 */
export async function enqueue<E extends EventName>(
  event: E,
  payload: EventPayload<E>,
  options?: { idempotencyKey?: string },
): Promise<string> {
  const validated = parseEventPayload(event, payload);

  const envelope: JobEnvelope = {
    event,
    payload: validated,
    enqueuedAt: new Date().toISOString(),
    ...(options?.idempotencyKey
      ? { idempotencyKey: options.idempotencyKey }
      : {}),
  };

  const adapter = resolveAdapter();
  return adapter.publish(keys().BULLMQ_QUEUE_NAME, envelope);
}
