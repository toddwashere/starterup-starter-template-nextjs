import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/campaigns", () => ({
  processDeliveryEvents: vi.fn(),
}));

import { processDeliveryEvents } from "@workspace/campaigns";
import { handleEmailProcessDeliveryEvents } from "./process-delivery-events";

describe("handleEmailProcessDeliveryEvents", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to processDeliveryEvents", async () => {
    const events = [
      {
        type: "delivered" as const,
        providerMessageId: "msg_1",
        occurredAt: new Date().toISOString(),
      },
    ];

    await handleEmailProcessDeliveryEvents({ provider: "resend", events });

    expect(processDeliveryEvents).toHaveBeenCalledWith("resend", events);
  });
});
