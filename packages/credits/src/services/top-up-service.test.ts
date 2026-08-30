import { describe, expect, it, vi } from "vitest";
import {
  grantStripeTopUp,
  listCreditTopUpProducts,
  resolveCreditTopUpProduct,
} from "./top-up-service";
import { grantCredits } from "./usage-service";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    creditTopUpPurchase: {
      upsert: vi.fn(async ({ create }) => create),
      update: vi.fn(async ({ data }) => data),
    },
  },
}));

vi.mock("./usage-service", () => ({
  grantCredits: vi.fn(async (input) => input),
}));
vi.mock("@workspace/database", () => ({ prisma: prismaMock }));

describe("top-up-service", () => {
  it("lists active configured top-up products without resolving Stripe env", () => {
    expect(listCreditTopUpProducts()).toEqual([
      expect.objectContaining({
        name: "starter_pack",
        displayName: "Starter Pack",
        credits: 100_000,
      }),
    ]);
  });

  it("resolves an active top-up product by name", () => {
    expect(resolveCreditTopUpProduct("starter_pack")).toMatchObject({
      credits: 100_000,
    });
  });

  it("grants Stripe top-up credits to the wallet idempotently", async () => {
    await grantStripeTopUp({
      organizationId: "org_1",
      topUpProductName: "starter_pack",
      stripeCheckoutSessionId: "cs_1",
      stripePaymentIntentId: "pi_1",
      stripeAmountPaidInCents: 2_500,
    });

    expect(grantCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        amountCredits: 100_000,
        bucket: "wallet",
        source: "stripe",
        usageArea: "stripe_top_up",
        idempotencyKey: "stripe_top_up:cs_1",
        metadata: expect.objectContaining({
          stripePaymentIntentId: "pi_1",
          stripeAmountPaidInCents: 2_500,
        }),
      }),
    );
    expect(prismaMock.creditTopUpPurchase.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeCheckoutSessionId: "cs_1" },
        create: expect.objectContaining({
          organizationId: "org_1",
          topUpProductName: "starter_pack",
          credits: 100_000,
          stripeAmountPaidInCents: 2_500,
          status: "paid",
        }),
      }),
    );
    expect(prismaMock.creditTopUpPurchase.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { stripeCheckoutSessionId: "cs_1" },
        data: expect.objectContaining({ status: "fulfilled" }),
      }),
    );
  });
});
