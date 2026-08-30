import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, prismaMock } = vi.hoisted(() => {
  const state = {
    accounts: new Map<string, any>(),
    events: new Map<string, any>(),
    ledgers: [] as any[],
  };

  const prismaMock = {
    creditAccount: {
      upsert: vi.fn(async ({ where, create }: any) => {
        const existing = state.accounts.get(where.organizationId);
        if (existing) return existing;
        const account = { ...create, currentPeriodStart: null, currentPeriodEnd: null };
        state.accounts.set(where.organizationId, account);
        return account;
      }),
      update: vi.fn(async ({ where, data }: any) => {
        const next = { ...state.accounts.get(where.organizationId), ...data };
        state.accounts.set(where.organizationId, next);
        return next;
      }),
    },
    creditUsageEvent: {
      findUnique: vi.fn(async ({ where }: any) => {
        const key = where.organizationId_idempotencyKey;
        return state.events.get(`${key.organizationId}:${key.idempotencyKey}`) ?? null;
      }),
      create: vi.fn(async ({ data }: any) => {
        const event = { ...data, createdAt: new Date() };
        state.events.set(`${data.organizationId}:${data.idempotencyKey}`, event);
        return event;
      }),
    },
    creditLedgerEntry: {
      createMany: vi.fn(async ({ data }: any) => {
        state.ledgers.push(...data);
        return { count: data.length };
      }),
    },
  };

  return { state, prismaMock };
});

vi.mock("@workspace/database", () => ({
  prisma: { ...prismaMock, $transaction: async (fn: any) => fn(prismaMock) },
}));

import { grantMonthlyAllowance } from "./allowance-service";
import { getOrgCreditBalance } from "./balance-service";

const AUGUST = {
  periodStart: new Date("2026-08-01T00:00:00.000Z"),
  periodEnd: new Date("2026-09-01T00:00:00.000Z"),
};
const SEPTEMBER = {
  periodStart: new Date("2026-09-01T00:00:00.000Z"),
  periodEnd: new Date("2026-10-01T00:00:00.000Z"),
};

async function grant(period: typeof AUGUST, policy: Record<string, unknown>) {
  return grantMonthlyAllowance({
    organizationId: "org_1",
    planName: "pro",
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    policy,
  });
}

describe("monthly allowance period rollover", () => {
  beforeEach(() => {
    state.accounts.clear();
    state.events.clear();
    state.ledgers.length = 0;
    vi.clearAllMocks();
  });

  it("expires leftover allowance before granting the next period", async () => {
    await grant(AUGUST, { monthlyAllowanceCredits: 100, allowanceUnusedPolicy: "expire" });
    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      monthlyAllowanceBalanceCredits: 100,
    });

    await grant(SEPTEMBER, { monthlyAllowanceCredits: 100, allowanceUnusedPolicy: "expire" });

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      monthlyAllowanceBalanceCredits: 100,
      totalBalanceCredits: 100,
    });
    expect(state.ledgers).toContainEqual(
      expect.objectContaining({
        effect: "decrease",
        bucket: "monthly_allowance",
        amountCredits: 100,
        balanceAfterCredits: 0,
      }),
    );
  });

  it("carries leftover allowance forward when the policy is rollover", async () => {
    await grant(AUGUST, { monthlyAllowanceCredits: 100, allowanceUnusedPolicy: "rollover" });
    await grant(SEPTEMBER, { monthlyAllowanceCredits: 100, allowanceUnusedPolicy: "rollover" });

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      monthlyAllowanceBalanceCredits: 200,
      totalBalanceCredits: 200,
    });
    expect(state.ledgers.filter((entry) => entry.effect === "decrease")).toHaveLength(0);
  });

  it("caps carried-over allowance at rolloverCapCredits", async () => {
    await grant(AUGUST, {
      monthlyAllowanceCredits: 100,
      allowanceUnusedPolicy: "rollover",
      rolloverCapCredits: 30,
    });
    await grant(SEPTEMBER, {
      monthlyAllowanceCredits: 100,
      allowanceUnusedPolicy: "rollover",
      rolloverCapCredits: 30,
    });

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      monthlyAllowanceBalanceCredits: 130,
      totalBalanceCredits: 130,
    });
    expect(state.ledgers).toContainEqual(
      expect.objectContaining({
        effect: "decrease",
        bucket: "monthly_allowance",
        amountCredits: 70,
        balanceAfterCredits: 30,
      }),
    );
  });

  it("writes the current period window onto the credit account", async () => {
    await grant(AUGUST, { monthlyAllowanceCredits: 100 });

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      currentPeriodStart: AUGUST.periodStart,
      currentPeriodEnd: AUGUST.periodEnd,
    });
  });

  it("applies the period reset and grant only once per period", async () => {
    await grant(AUGUST, { monthlyAllowanceCredits: 100, allowanceUnusedPolicy: "expire" });
    await grant(AUGUST, { monthlyAllowanceCredits: 100, allowanceUnusedPolicy: "expire" });

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      monthlyAllowanceBalanceCredits: 100,
      totalBalanceCredits: 100,
    });
  });

  it("expires leftover allowance on a downgrade to a plan with no allowance", async () => {
    await grant(AUGUST, { monthlyAllowanceCredits: 100, allowanceUnusedPolicy: "expire" });
    await expect(grant(SEPTEMBER, {})).resolves.toBeNull();

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      monthlyAllowanceBalanceCredits: 0,
      totalBalanceCredits: 0,
    });
  });
});
