import { events, type EventName } from "@workspace/worker-queue";
import { describe, expect, it, vi } from "vitest";

import { getHandler, type HandlerRegistry } from "./registry";

describe("getHandler", () => {
  it("returns the registered handler for an event and it can be called", async () => {
    const welcome = vi.fn(async () => {});
    const cleanup = vi.fn(async () => {});
    const webhook = vi.fn(async () => {});
    const registry: HandlerRegistry = {
      "user.welcome-email": welcome,
      "cleanup.expired-sessions": cleanup,
      "webhook.deliver": webhook,
      "ai.example": vi.fn(async () => {}),
      "campaign.enroll-segment": vi.fn(async () => {}),
      "campaign.send-step": vi.fn(async () => {}),
      "campaign.schedule-next-step": vi.fn(async () => {}),
      "email.process-delivery-events": vi.fn(async () => {}),
    };

    const handler = getHandler(registry, "user.welcome-email");
    await handler({ userId: "u1" });

    expect(handler).toBe(welcome);
    expect(welcome).toHaveBeenCalledWith({ userId: "u1" });
  });

  it("throws for an unregistered event", () => {
    const partial = {
      "user.welcome-email": vi.fn(async () => {}),
      "cleanup.expired-sessions": vi.fn(async () => {}),
    } as unknown as HandlerRegistry;

    expect(() => getHandler(partial, "webhook.deliver")).toThrow(
      "No handler registered for event: webhook.deliver",
    );
  });

  it("throws for an empty registry", () => {
    const empty = {} as HandlerRegistry;

    expect(() => getHandler(empty, "user.welcome-email")).toThrow(
      "No handler registered for event: user.welcome-email",
    );
  });

  it("documents the event-name contract the registry must satisfy", () => {
    const eventNames = Object.keys(events) as EventName[];
    expect(eventNames.sort()).toEqual(
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
