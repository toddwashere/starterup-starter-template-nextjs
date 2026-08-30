"use server";

import { requireUser } from "@workspace/auth/guards";
import { getOrgCreditBalance } from "@workspace/credits";
import type { ActionResult } from "@/common/data/action-result";
import { dashboardConfig } from "../../../dashboard.config";

export type AiChatCreditStatus = {
  totalBalanceCredits: number;
  monthlyAllowanceBalanceCredits: number;
  walletBalanceCredits: number;
  isLow: boolean;
  isExhausted: boolean;
};

/**
 * Credit balance for the assistant-chat header. Returns null when the chat
 * credit UI is turned off in `dashboard.config.ts`, so the client can skip
 * rendering entirely rather than showing a zeroed-out widget.
 */
export async function getAiChatCreditStatusAction(): Promise<
  ActionResult<AiChatCreditStatus | null>
> {
  const { credits } = dashboardConfig.features;
  if (!credits.showInAiChat) {
    return { success: true, data: null };
  }

  try {
    const session = await requireUser();
    const activeOrganizationId = (session.session as { activeOrganizationId?: string | null })
      .activeOrganizationId;

    if (!activeOrganizationId) {
      return { success: false, error: "No active organization selected" };
    }

    const balance = await getOrgCreditBalance(activeOrganizationId);
    const isExhausted = balance.totalBalanceCredits <= 0;

    return {
      success: true,
      data: {
        totalBalanceCredits: balance.totalBalanceCredits,
        monthlyAllowanceBalanceCredits: balance.monthlyAllowanceBalanceCredits,
        walletBalanceCredits: balance.walletBalanceCredits,
        isExhausted,
        isLow:
          credits.showLowBalanceWarnings &&
          balance.totalBalanceCredits <= credits.lowBalanceWarningThresholdCredits,
      },
    };
  } catch {
    return { success: false, error: "Could not load credit balance" };
  }
}
