import type { EventName, EventPayload } from "@workspace/worker-queue";

/** A handler for a single event, receiving its validated payload. */
export type JobHandler<E extends EventName> = (
  payload: EventPayload<E>,
) => Promise<void>;

/**
 * A complete registry: one handler per event. The mapped type enforces
 * compile-time coverage of every event in the worker-queue events registry.
 */
export type HandlerRegistry = { [E in EventName]: JobHandler<E> };

/**
 * Runtime lookup with a clear error if a handler is missing (e.g. a registry
 * built dynamically/partially). Throws for unknown/unregistered events.
 */
export function getHandler(
  registry: HandlerRegistry,
  event: EventName,
): JobHandler<EventName> {
  const handler = registry[event] as JobHandler<EventName> | undefined;
  if (!handler) {
    throw new Error(`No handler registered for event: ${event}`);
  }
  return handler;
}
