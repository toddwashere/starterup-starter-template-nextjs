import { describe, expect, it } from "vitest";

import { handleWebhookDeliver } from "./webhook-deliver";

describe("handleWebhookDeliver", () => {
  it("resolves without throwing (stub)", async () => {
    await expect(
      handleWebhookDeliver({ deliveryId: "d1" }),
    ).resolves.toBeUndefined();
  });
});
