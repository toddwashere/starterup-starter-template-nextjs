import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  InsufficientCreditsError,
  beginCreditUsage,
  ensureOrgCanSpendCredits,
  getOrgCreditBalance,
  grantCredits,
  runWithCreditCharge,
} from "../index";

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
        const account = {
          ...create,
          createdAt: new Date(),
          updatedAt: new Date(),
        };
        state.accounts.set(where.organizationId, account);
        return account;
      }),
      findUnique: vi.fn(async ({ where }: any) => state.accounts.get(where.organizationId) ?? null),
      update: vi.fn(async ({ where, data }: any) => {
        const current = state.accounts.get(where.organizationId);
        const next = { ...current, ...data, updatedAt: new Date() };
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
      update: vi.fn(async ({ where, data }: any) => {
        const key = where.organizationId_idempotencyKey;
        const mapKey = `${key.organizationId}:${key.idempotencyKey}`;
        const event = { ...state.events.get(mapKey), ...data };
        state.events.set(mapKey, event);
        return event;
      }),
      findMany: vi.fn(async () => Array.from(state.events.values())),
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

describe("credit usage services", () => {
  beforeEach(() => {
    state.accounts.clear();
    state.events.clear();
    state.ledgers.length = 0;
    vi.clearAllMocks();
  });

  it("creates an account with zero balances when balance is requested", async () => {
    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      organizationId: "org_1",
      totalBalanceCredits: 0,
    });
  });

  it("blocks charged work when the total balance is zero", async () => {
    await expect(
      ensureOrgCanSpendCredits({ organizationId: "org_1", chargeToOrg: true }),
    ).rejects.toBeInstanceOf(InsufficientCreditsError);
  });

  it("does not debit credits when wrapped work fails", async () => {
    await grantCredits({
      organizationId: "org_1",
      amountCredits: 100,
      bucket: "wallet",
      source: "system",
      usageArea: "admin_adjustment",
      idempotencyKey: "grant_1",
    });

    await expect(
      runWithCreditCharge({
        organizationId: "org_1",
        chargeToOrg: true,
        source: "public_mcp",
        usageArea: "mcp_tool",
        idempotencyKey: "tool_1",
        cost: { mode: "fixed", credits: 10 },
        run: async () => {
          throw new Error("tool failed");
        },
      }),
    ).rejects.toThrow("tool failed");

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      walletBalanceCredits: 100,
      totalBalanceCredits: 100,
    });
    expect(state.ledgers).toHaveLength(1);
  });

  it("spends monthly allowance before wallet and records positive ledger movement", async () => {
    await grantCredits({
      organizationId: "org_1",
      amountCredits: 50,
      bucket: "monthly_allowance",
      source: "system",
      usageArea: "monthly_allowance",
      idempotencyKey: "grant_allowance",
    });
    await grantCredits({
      organizationId: "org_1",
      amountCredits: 50,
      bucket: "wallet",
      source: "system",
      usageArea: "stripe_top_up",
      idempotencyKey: "grant_wallet",
    });

    await runWithCreditCharge({
      organizationId: "org_1",
      chargeToOrg: true,
      source: "dashboard",
      usageArea: "assistant_chat",
      idempotencyKey: "chat_1",
      cost: { mode: "fixed", credits: 70 },
      run: async () => "ok",
    });

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      monthlyAllowanceBalanceCredits: 0,
      walletBalanceCredits: 30,
      totalBalanceCredits: 30,
    });
    expect(state.ledgers.slice(-2)).toEqual([
      expect.objectContaining({
        effect: "decrease",
        bucket: "monthly_allowance",
        amountCredits: 50,
      }),
      expect.objectContaining({
        effect: "decrease",
        bucket: "wallet",
        amountCredits: 20,
      }),
    ]);
  });

  it("allows successful usage to create overdraft and repays it before adding wallet credits", async () => {
    await grantCredits({
      organizationId: "org_1",
      amountCredits: 10,
      bucket: "wallet",
      source: "system",
      usageArea: "admin_adjustment",
      idempotencyKey: "grant_wallet",
    });

    await runWithCreditCharge({
      organizationId: "org_1",
      chargeToOrg: true,
      source: "dashboard",
      usageArea: "agent_run",
      idempotencyKey: "agent_1",
      cost: { mode: "fixed", credits: 25 },
      run: async () => "ok",
    });

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      walletBalanceCredits: 0,
      overdraftCredits: 15,
      totalBalanceCredits: -15,
    });

    await grantCredits({
      organizationId: "org_1",
      amountCredits: 20,
      bucket: "wallet",
      source: "stripe",
      usageArea: "stripe_top_up",
      idempotencyKey: "topup_1",
    });

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      walletBalanceCredits: 5,
      overdraftCredits: 0,
      totalBalanceCredits: 5,
    });
  });

  it("settles streaming model usage only after beginCreditUsage succeeds", async () => {
    await grantCredits({
      organizationId: "org_1",
      amountCredits: 1_000,
      bucket: "wallet",
      source: "system",
      usageArea: "admin_adjustment",
      idempotencyKey: "grant_wallet",
    });

    const usage = await beginCreditUsage({
      organizationId: "org_1",
      chargeToOrg: true,
      source: "dashboard",
      usageArea: "assistant_chat",
      idempotencyKey: "chat_usage",
    });

    await usage.settleModelUsage({
      providerModel: "openai:gpt-4o-mini",
      usage: { inputTokens: 100, outputTokens: 50 },
    });

    await expect(getOrgCreditBalance("org_1")).resolves.toMatchObject({
      walletBalanceCredits: 625,
      totalBalanceCredits: 625,
    });
  });
});
