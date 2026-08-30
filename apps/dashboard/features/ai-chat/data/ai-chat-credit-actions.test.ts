import { beforeEach, describe, expect, it, vi } from "vitest";

const { config } = vi.hoisted(() => ({
  config: {
    features: {
      credits: {
        showInBilling: true,
        showInAiChat: true,
        showLowBalanceWarnings: true,
        lowBalanceWarningThresholdCredits: 5_000,
      },
    },
  },
}));

vi.mock("../../../dashboard.config", () => ({ dashboardConfig: config }));
vi.mock("@workspace/auth/guards", () => ({ requireUser: vi.fn() }));
vi.mock("@workspace/credits", () => ({ getOrgCreditBalance: vi.fn() }));

import { requireUser } from "@workspace/auth/guards";
import { getOrgCreditBalance } from "@workspace/credits";
import { getAiChatCreditStatusAction } from "./ai-chat-credit-actions";

function mockBalance(totalBalanceCredits: number) {
  vi.mocked(getOrgCreditBalance).mockResolvedValue({
    monthlyAllowanceBalanceCredits: 0,
    walletBalanceCredits: totalBalanceCredits,
    overdraftCredits: 0,
    totalBalanceCredits,
  } as never);
}

describe("getAiChatCreditStatusAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    config.features.credits.showInAiChat = true;
    config.features.credits.showLowBalanceWarnings = true;
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user_1" },
      session: { activeOrganizationId: "org_1" },
    } as never);
  });

  it("returns no status and never reads the balance when showInAiChat is off", async () => {
    config.features.credits.showInAiChat = false;

    await expect(getAiChatCreditStatusAction()).resolves.toEqual({
      success: true,
      data: null,
    });
    expect(getOrgCreditBalance).not.toHaveBeenCalled();
  });

  it("flags a low balance when it is at or below the configured threshold", async () => {
    mockBalance(5_000);

    await expect(getAiChatCreditStatusAction()).resolves.toMatchObject({
      success: true,
      data: { totalBalanceCredits: 5_000, isLow: true, isExhausted: false },
    });
  });

  it("does not flag a healthy balance", async () => {
    mockBalance(5_001);

    await expect(getAiChatCreditStatusAction()).resolves.toMatchObject({
      data: { isLow: false, isExhausted: false },
    });
  });

  it("reports an exhausted balance", async () => {
    mockBalance(0);

    await expect(getAiChatCreditStatusAction()).resolves.toMatchObject({
      data: { isLow: true, isExhausted: true },
    });
  });

  it("suppresses the low-balance flag when warnings are disabled", async () => {
    config.features.credits.showLowBalanceWarnings = false;
    mockBalance(10);

    await expect(getAiChatCreditStatusAction()).resolves.toMatchObject({
      data: { totalBalanceCredits: 10, isLow: false, isExhausted: false },
    });
  });

  it("fails cleanly without an active organization", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      user: { id: "user_1" },
      session: {},
    } as never);

    await expect(getAiChatCreditStatusAction()).resolves.toEqual({
      success: false,
      error: "No active organization selected",
    });
  });
});
