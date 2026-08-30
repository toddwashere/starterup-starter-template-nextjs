import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    organization: { findUnique: vi.fn() },
    member: { findMany: vi.fn() },
  },
}));

vi.mock("@workspace/email", () => ({
  sendSubscriptionWelcomeEmail: vi.fn(),
  sendSubscriptionCanceledEmail: vi.fn(),
  sendPaymentFailedEmail: vi.fn(),
}));

vi.mock("@workspace/credits", () => ({
  grantMonthlyAllowance: vi.fn(),
}));

vi.mock("../data-models/billing-plan-repo", () => ({
  getBillingPlanByName: vi.fn(),
}));

import { prisma } from "@workspace/database";
import { grantMonthlyAllowance } from "@workspace/credits";
import { getBillingPlanByName } from "../data-models/billing-plan-repo";
import { handleSubscriptionComplete } from "./subscription-lifecycle";

describe("subscription credit lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("grants plan monthly allowance from creditPolicy on subscription completion", async () => {
    vi.mocked(prisma.organization.findUnique).mockResolvedValue({
      name: "Acme",
    } as never);
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      { role: "owner", user: { email: "owner@acme.test" } },
    ] as never);
    vi.mocked(getBillingPlanByName).mockResolvedValue({
      name: "pro",
      displayName: "Pro",
      creditPolicy: { monthlyAllowanceCredits: 100_000 },
    } as never);

    await handleSubscriptionComplete({
      subscription: {
        referenceId: "org_1",
        plan: "pro",
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      },
    });

    expect(grantMonthlyAllowance).toHaveBeenCalledWith({
      organizationId: "org_1",
      planName: "pro",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      policy: { monthlyAllowanceCredits: 100_000 },
    });
  });
});
