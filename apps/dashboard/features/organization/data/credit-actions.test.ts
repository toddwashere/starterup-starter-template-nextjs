import { beforeEach, describe, expect, it, vi } from "vitest";

const { config } = vi.hoisted(() => ({
  config: { features: { credits: { showInBilling: true } } },
}));

vi.mock("../../../dashboard.config", () => ({ dashboardConfig: config }));
vi.mock("next/headers", () => ({ headers: vi.fn(async () => new Headers()) }));
vi.mock("@workspace/auth", () => ({ auth: { api: { hasPermission: vi.fn() } } }));
vi.mock("@workspace/billing/stripe-client", () => ({ getStripeClient: vi.fn() }));
vi.mock("@workspace/credits", () => ({
  getOrgCreditBalance: vi.fn(),
  listCreditActivity: vi.fn(),
  listCreditTopUpProducts: vi.fn(),
}));

import {
  getOrgCreditBalance,
  listCreditActivity,
  listCreditTopUpProducts,
} from "@workspace/credits";
import { getCreditOverviewForOrg, listPublicCreditTopUpProducts } from "./credit-actions";

describe("dashboard credit billing UI flag", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.features.credits.showInBilling = true;
  });

  it("returns no overview and reads nothing when showInBilling is off", async () => {
    config.features.credits.showInBilling = false;

    await expect(getCreditOverviewForOrg("org_1")).resolves.toBeNull();
    expect(getOrgCreditBalance).not.toHaveBeenCalled();
    expect(listCreditActivity).not.toHaveBeenCalled();
  });

  it("returns no top-up products when showInBilling is off", async () => {
    config.features.credits.showInBilling = false;

    await expect(listPublicCreditTopUpProducts()).resolves.toEqual([]);
    expect(listCreditTopUpProducts).not.toHaveBeenCalled();
  });

  it("projects balance and activity when the flag is on", async () => {
    vi.mocked(getOrgCreditBalance).mockResolvedValue({
      monthlyAllowanceBalanceCredits: 100,
      walletBalanceCredits: 50,
      overdraftCredits: 0,
      totalBalanceCredits: 150,
      currentPeriodStart: new Date("2026-08-01T00:00:00.000Z"),
      currentPeriodEnd: new Date("2026-09-01T00:00:00.000Z"),
    } as never);
    vi.mocked(listCreditActivity).mockResolvedValue([
      {
        id: "creduse_1",
        status: "settled",
        source: "dashboard",
        usageArea: "assistant_chat",
        creditsCharged: 25,
        createdAt: new Date("2026-08-15T00:00:00.000Z"),
        ledgerEntries: [{ effect: "decrease", bucket: "wallet", amountCredits: 25 }],
      },
    ] as never);

    const overview = await getCreditOverviewForOrg("org_1");

    expect(overview?.balance).toMatchObject({ totalBalanceCredits: 150 });
    expect(overview?.activity).toEqual([
      expect.objectContaining({
        id: "creduse_1",
        usageArea: "assistant_chat",
        creditsCharged: 25,
        ledgerEntries: [{ effect: "decrease", bucket: "wallet", amountCredits: 25 }],
      }),
    ]);
  });

  it("exposes only public top-up product fields", async () => {
    vi.mocked(listCreditTopUpProducts).mockReturnValue([
      {
        name: "starter_pack",
        displayName: "Starter Pack",
        credits: 100_000,
        stripePriceIdEnvVar: "STRIPE_PRICE_CREDITS_STARTER",
        isActive: true,
        sortOrder: 0,
      },
    ] as never);

    await expect(listPublicCreditTopUpProducts()).resolves.toEqual([
      { name: "starter_pack", displayName: "Starter Pack", credits: 100_000 },
    ]);
  });
});
