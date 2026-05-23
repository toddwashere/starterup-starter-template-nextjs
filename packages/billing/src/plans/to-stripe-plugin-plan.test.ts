import { describe, it, expect } from "vitest";
import { toStripePluginPlan } from "./to-stripe-plugin-plan";

const baseRow = {
  name: "pro",
  displayName: "Pro",
  stripePriceIdMonthly: "price_monthly",
  stripePriceIdAnnual: "price_annual",
  stripeLookupKeyMonthly: null,
  stripeLookupKeyAnnual: null,
  limits: { contacts: 1000 },
  freeTrialDays: null,
  seatPriceId: null,
  group: "main",
};

describe("toStripePluginPlan", () => {
  it("maps priceId and annualDiscountPriceId", () => {
    const plan = toStripePluginPlan(baseRow as never);
    expect(plan).toMatchObject({
      name: "pro",
      priceId: "price_monthly",
      annualDiscountPriceId: "price_annual",
      limits: { contacts: 1000 },
    });
    expect(plan.freeTrial).toBeUndefined();
  });

  it("includes freeTrial when freeTrialDays set", () => {
    const plan = toStripePluginPlan({ ...baseRow, freeTrialDays: 14 } as never);
    expect(plan.freeTrial).toEqual({ days: 14 });
  });

  it("uses lookupKey instead of priceId when stripeLookupKeyMonthly is set", () => {
    const plan = toStripePluginPlan({ ...baseRow, stripeLookupKeyMonthly: "lk_pro" } as never);
    expect(plan.lookupKey).toBe("lk_pro");
  });
});
