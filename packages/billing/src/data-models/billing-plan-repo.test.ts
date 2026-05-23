import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    billingPlan: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@workspace/database";
import { listActiveBillingPlans, getBillingPlanByName } from "./billing-plan-repo";

describe("billing-plan-repo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listActiveBillingPlans excludes inactive and sorts by sortOrder", async () => {
    vi.mocked(prisma.billingPlan.findMany).mockResolvedValue([
      { name: "pro", isActive: true, sortOrder: 1 },
    ] as never);
    const rows = await listActiveBillingPlans();
    expect(prisma.billingPlan.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    expect(rows).toHaveLength(1);
  });

  it("getBillingPlanByName returns free plan", async () => {
    vi.mocked(prisma.billingPlan.findUnique).mockResolvedValue({
      name: "free",
      limits: { contacts: 50 },
    } as never);
    const plan = await getBillingPlanByName("free");
    expect(plan?.name).toBe("free");
    expect(prisma.billingPlan.findUnique).toHaveBeenCalledWith({ where: { name: "free" } });
  });
});
