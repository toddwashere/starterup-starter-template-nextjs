import { describe, expect, it } from "vitest";

import {
  events,
  isEventName,
  parseEventPayload,
  parseJobEnvelope,
} from "./events";

describe("events registry", () => {
  it("contains exactly the expected event names", () => {
    expect(Object.keys(events).sort()).toEqual(
      [
        "ai.example",
        "campaign.enroll-segment",
        "campaign.schedule-next-step",
        "campaign.send-step",
        "cleanup.expired-sessions",
        "email.process-delivery-events",
        "user.welcome-email",
        "webhook.deliver",
      ].sort(),
    );
  });
});

describe("parseEventPayload", () => {
  it("returns the payload for a valid user.welcome-email", () => {
    expect(parseEventPayload("user.welcome-email", { userId: "u1" })).toEqual({
      userId: "u1",
    });
  });

  it("throws when user.welcome-email is missing userId", () => {
    expect(() => parseEventPayload("user.welcome-email", {})).toThrow();
  });

  it("throws when user.welcome-email userId is the wrong type", () => {
    expect(() =>
      parseEventPayload("user.welcome-email", { userId: 123 }),
    ).toThrow();
  });

  it("accepts an empty object for cleanup.expired-sessions", () => {
    expect(parseEventPayload("cleanup.expired-sessions", {})).toEqual({});
  });

  it("strips unknown keys for cleanup.expired-sessions", () => {
    expect(
      parseEventPayload("cleanup.expired-sessions", { junk: true }),
    ).toEqual({});
  });

  it("returns the payload for a valid webhook.deliver", () => {
    expect(
      parseEventPayload("webhook.deliver", { deliveryId: "d1" }),
    ).toEqual({ deliveryId: "d1" });
  });

  it("throws when webhook.deliver is missing deliveryId", () => {
    expect(() => parseEventPayload("webhook.deliver", {})).toThrow();
  });
});

describe("isEventName", () => {
  it("returns true for known event names", () => {
    expect(isEventName("user.welcome-email")).toBe(true);
    expect(isEventName("cleanup.expired-sessions")).toBe(true);
    expect(isEventName("webhook.deliver")).toBe(true);
  });

  it("returns false for unknown event names", () => {
    expect(isEventName("does.not.exist")).toBe(false);
    expect(isEventName("")).toBe(false);
  });
});

describe("parseJobEnvelope", () => {
  it("accepts a well-formed user.welcome-email envelope", () => {
    const result = parseJobEnvelope({
      event: "user.welcome-email",
      payload: { userId: "u1" },
    });

    expect(result).toEqual({
      event: "user.welcome-email",
      payload: { userId: "u1" },
    });
  });

  it("accepts a well-formed cleanup.expired-sessions envelope", () => {
    const result = parseJobEnvelope({
      event: "cleanup.expired-sessions",
      payload: {},
    });

    expect(result).toEqual({
      event: "cleanup.expired-sessions",
      payload: {},
    });
  });

  it("accepts a well-formed webhook.deliver envelope", () => {
    const result = parseJobEnvelope({
      event: "webhook.deliver",
      payload: { deliveryId: "d1" },
    });

    expect(result).toEqual({
      event: "webhook.deliver",
      payload: { deliveryId: "d1" },
    });
  });

  it("preserves idempotencyKey and enqueuedAt when present", () => {
    const result = parseJobEnvelope({
      event: "user.welcome-email",
      payload: { userId: "u1" },
      idempotencyKey: "key-1",
      enqueuedAt: "2026-05-23T00:00:00.000Z",
    });

    expect(result).toEqual({
      event: "user.welcome-email",
      payload: { userId: "u1" },
      idempotencyKey: "key-1",
      enqueuedAt: "2026-05-23T00:00:00.000Z",
    });
  });

  it("rejects an unknown event name", () => {
    expect(() =>
      parseJobEnvelope({ event: "does.not.exist", payload: {} }),
    ).toThrow();
  });

  it("rejects a known event with an invalid payload", () => {
    expect(() =>
      parseJobEnvelope({ event: "user.welcome-email", payload: {} }),
    ).toThrow();
  });

  it("rejects a non-string event", () => {
    expect(() =>
      parseJobEnvelope({ event: 123, payload: {} }),
    ).toThrow();
  });

  it("rejects a non-object input", () => {
    expect(() => parseJobEnvelope("not an object")).toThrow();
    expect(() => parseJobEnvelope(null)).toThrow();
  });
});
