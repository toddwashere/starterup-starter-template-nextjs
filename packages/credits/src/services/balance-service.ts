import { createId } from "@workspace/common";
import type { PrismaClient } from "@workspace/database";
import { prisma } from "@workspace/database";
import { Prisma } from "@workspace/database";
import { creditsConfig } from "../../credits.config";
import { InsufficientCreditsError } from "../errors";

type Db = PrismaClient | Prisma.TransactionClient;

export function calculateTotalBalance(input: {
  monthlyAllowanceBalanceCredits: number;
  walletBalanceCredits: number;
  overdraftCredits: number;
}): number {
  return input.monthlyAllowanceBalanceCredits + input.walletBalanceCredits - input.overdraftCredits;
}

export async function getOrCreateCreditAccount(organizationId: string, db: Db = prisma) {
  return db.creditAccount.upsert({
    where: { organizationId },
    update: {},
    create: {
      id: createId("credacct"),
      organizationId,
      monthlyAllowanceBalanceCredits: 0,
      walletBalanceCredits: 0,
      overdraftCredits: 0,
      totalBalanceCredits: 0,
    },
  });
}

export async function getOrgCreditBalance(organizationId: string) {
  return getOrCreateCreditAccount(organizationId);
}

export async function ensureOrgCanSpendCredits(input: {
  organizationId: string;
  chargeToOrg?: boolean;
}) {
  if (!input.chargeToOrg) return;

  const account = await getOrCreateCreditAccount(input.organizationId);
  if (
    account.totalBalanceCredits <= creditsConfig.policy.blockWhenBalanceCreditsLessThanOrEqualTo
  ) {
    throw new InsufficientCreditsError({
      organizationId: input.organizationId,
      balanceCredits: account.totalBalanceCredits,
    });
  }
}
