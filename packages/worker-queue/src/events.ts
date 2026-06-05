import { z } from "zod";

import type { JobEnvelope } from "./types";

/**
 * Registry mapping each event name to the zod schema for its payload.
 * Unknown object keys are stripped (default zod object behavior).
 */
export const events = {
  "user.welcome-email": z.object({ userId: z.string() }),
  "cleanup.expired-sessions": z.object({}),
  "webhook.deliver": z.object({ deliveryId: z.string() }),
  "ai.example": z.object({ text: z.string() }),
  "campaign.enroll-segment": z.object({ campaignRunId: z.string() }),
  "campaign.send-step": z.object({ stepSendId: z.string() }),
  "campaign.schedule-next-step": z.object({ enrollmentId: z.string() }),
  "email.process-delivery-events": z.object({
    provider: z.literal("resend"),
    events: z.array(
      z.object({
        type: z.enum(["delivered", "bounced", "complained"]),
        providerMessageId: z.string(),
        occurredAt: z.string(),
        recipient: z.string().optional(),
        bounceClass: z.enum(["hard", "soft"]).optional(),
        rawType: z.string().optional(),
      }),
    ),
  }),
} as const;

/** Union of the literal event-name strings in the registry. */
export type EventName = keyof typeof events;

/** Inferred payload type for a given event. */
export type EventPayload<E extends EventName> = z.infer<(typeof events)[E]>;

/** Runtime guard: is `value` a known event name? */
export function isEventName(value: string): value is EventName {
  return Object.prototype.hasOwnProperty.call(events, value);
}

/**
 * Validate `payload` against the schema registered for `event`.
 * Throws (zod) when the payload is invalid.
 */
export function parseEventPayload<E extends EventName>(
  event: E,
  payload: unknown,
): EventPayload<E> {
  return events[event].parse(payload) as EventPayload<E>;
}

/**
 * Validate the envelope shape and its payload against the events registry.
 * Rejects unknown event names and invalid payloads. Accepts an already-parsed
 * object (the consumer parses JSON before calling this), not a JSON string.
 */
export function parseJobEnvelope(raw: unknown): JobEnvelope {
  const base = z
    .object({
      event: z.string(),
      payload: z.unknown(),
      idempotencyKey: z.string().optional(),
      enqueuedAt: z.string().optional(),
    })
    .parse(raw);

  if (!isEventName(base.event)) {
    throw new Error(`Unknown event name: "${base.event}"`);
  }

  const payload = parseEventPayload(base.event, base.payload);

  const envelope: JobEnvelope = {
    event: base.event,
    payload,
  };
  if (base.idempotencyKey !== undefined) {
    envelope.idempotencyKey = base.idempotencyKey;
  }
  if (base.enqueuedAt !== undefined) {
    envelope.enqueuedAt = base.enqueuedAt;
  }
  return envelope;
}
