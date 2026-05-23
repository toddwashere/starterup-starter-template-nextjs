import { describe, it, expect, vi, beforeEach } from "vitest";
import { getOrgLimits } from "./get-org-limits";

vi.mock("../data-models/subscription-repo", () => ({
  getActiveSubscriptionForOrg: vi.fn(),
}));
vi.mock("../data-models/billing-plan-repo", () => ({
  getBillingPlanByName: vi.fn(),
}));

import { getActiveSubscriptionForOrg } from "../data-models/subscription-repo";
import { getBillingPlanByName } from "../data-models/billing-plan-repo";

describe("getOrgLimits", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns limits from active paid plan", async () => {
    vi.mocked(getActiveSubscriptionForOrg).mockResolvedValue({
      plan: "pro",
      status: "active",
    } as any);
    vi.mocked(getBillingPlanByName).mockResolvedValue({
      limits: { contacts: 1000 },
    } as any);

    const limits = await getOrgLimits("org-1");

    expect(limits).toEqual({ contacts: 1000 });
    expect(getBillingPlanByName).toHaveBeenCalledWith("pro");
  });

  it("falls back to free plan when there is no active subscription", async () => {
    vi.mocked(getActiveSubscriptionForOrg).mockResolvedValue(null);
    vi.mocked(getBillingPlanByName).mockResolvedValue({
      limits: { contacts: 50 },
    } as any);

    const limits = await getOrgLimits("org-2");

    expect(limits).toEqual({ contacts: 50 });
    expect(getBillingPlanByName).toHaveBeenCalledWith("free");
  });

  it("trialing subscription counts as paid and uses the subscribed plan", async () => {
    vi.mocked(getActiveSubscriptionForOrg).mockResolvedValue({
      plan: "pro",
      status: "trialing",
    } as any);
    vi.mocked(getBillingPlanByName).mockResolvedValue({
      limits: { contacts: 1000 },
    } as any);

    const limits = await getOrgLimits("org-3");

    expect(limits).toEqual({ contacts: 1000 });
    expect(getBillingPlanByName).toHaveBeenCalledWith("pro");
  });
});
