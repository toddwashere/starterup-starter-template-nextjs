import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/credits", () => ({ grantStripeTopUp: vi.fn() }));

import { grantStripeTopUp } from "@workspace/credits";
import { handleCreditTopUpCheckoutCompleted } from "./credit-top-up-lifecycle";

describe("handleCreditTopUpCheckoutCompleted", () => {
  beforeEach(() => vi.clearAllMocks());

  it("ignores checkout sessions that are not credit top-ups", async () => {
    await expect(
      handleCreditTopUpCheckoutCompleted({
        id: "cs_1",
        metadata: { kind: "subscription" },
      }),
    ).resolves.toBeNull();

    expect(grantStripeTopUp).not.toHaveBeenCalled();
  });

  it("grants the configured wallet top-up from Stripe metadata", async () => {
    await handleCreditTopUpCheckoutCompleted({
      id: "cs_1",
      payment_intent: "pi_1",
      amount_total: 2_500,
      metadata: {
        kind: "credit_top_up",
        organizationId: "org_1",
        topUpProductName: "starter_pack",
      },
    });

    expect(grantStripeTopUp).toHaveBeenCalledWith({
      organizationId: "org_1",
      topUpProductName: "starter_pack",
      stripeCheckoutSessionId: "cs_1",
      stripePaymentIntentId: "pi_1",
      stripeAmountPaidInCents: 2_500,
    });
  });
});
