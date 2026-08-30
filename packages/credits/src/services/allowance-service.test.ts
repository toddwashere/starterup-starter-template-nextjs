import { describe, expect, it, vi } from "vitest";
import { grantMonthlyAllowance } from "./allowance-service";
import { grantCredits } from "./usage-service";

vi.mock("./usage-service", () => ({
  grantCredits: vi.fn(async (input) => input),
  applyAllowancePeriodReset: vi.fn(async () => ({
    alreadyApplied: false,
    expiredCredits: 0,
    carriedCredits: 0,
  })),
}));

describe("grantMonthlyAllowance", () => {
  it("does not grant credits when the policy has no allowance", async () => {
    await expect(
      grantMonthlyAllowance({
        organizationId: "org_1",
        planName: "free",
        periodStart: new Date("2026-08-01T00:00:00.000Z"),
        periodEnd: new Date("2026-09-01T00:00:00.000Z"),
        policy: {},
      }),
    ).resolves.toBeNull();

    expect(grantCredits).not.toHaveBeenCalled();
  });

  it("grants monthly allowance credits with a stable period idempotency key", async () => {
    await grantMonthlyAllowance({
      organizationId: "org_1",
      planName: "pro",
      periodStart: new Date("2026-08-01T00:00:00.000Z"),
      periodEnd: new Date("2026-09-01T00:00:00.000Z"),
      policy: { monthlyAllowanceCredits: 100_000 },
    });

    expect(grantCredits).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        amountCredits: 100_000,
        bucket: "monthly_allowance",
        source: "system",
        usageArea: "monthly_allowance",
        idempotencyKey: "monthly_allowance:org_1:pro:2026-08-01T00:00:00.000Z",
      }),
    );
  });
});
