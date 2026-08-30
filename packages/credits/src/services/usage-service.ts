import { createId } from "@workspace/common";
import type { PrismaClient } from "@workspace/database";
import { prisma } from "@workspace/database";
import { Prisma } from "@workspace/database";
import type {
  AiUsageLike,
  CreditActor,
  CreditCost,
  CreditGrantBucket,
  CreditSource,
  CreditUsageArea,
} from "../types";
import { normalizeModelUsage } from "./normalization";
import {
  calculateTotalBalance,
  ensureOrgCanSpendCredits,
  getOrCreateCreditAccount,
} from "./balance-service";

type Db = PrismaClient | Prisma.TransactionClient;
type CreditBucket = "monthly_allowance" | "wallet" | "overdraft";

type UsageInput = {
  organizationId: string;
  chargeToOrg?: boolean;
  source: CreditSource;
  usageArea: CreditUsageArea | string;
  idempotencyKey: string;
  actor?: CreditActor;
  metadata?: Record<string, unknown>;
};

function actorFields(actor?: CreditActor) {
  if (!actor || actor.kind === "system") return { actorKind: actor?.kind };
  if (actor.kind === "user") {
    return { actorKind: actor.kind, userId: actor.userId };
  }
  if (actor.kind === "api_key") {
    return {
      actorKind: actor.kind,
      apiKeyId: actor.apiKeyId,
      userId: actor.userId ?? null,
    };
  }
  return {
    actorKind: actor.kind,
    oauthClientId: actor.oauthClientId,
    userId: actor.userId ?? null,
  };
}

function assertPositiveCredits(amountCredits: number) {
  if (!Number.isInteger(amountCredits) || amountCredits <= 0) {
    throw new Error("amountCredits must be a positive integer");
  }
}

async function findUsageEvent(db: Db, input: UsageInput) {
  return db.creditUsageEvent.findUnique({
    where: {
      organizationId_idempotencyKey: {
        organizationId: input.organizationId,
        idempotencyKey: input.idempotencyKey,
      },
    },
  });
}

async function createUsageEvent(
  db: Db,
  input: UsageInput & {
    status: "pending" | "settled" | "failed" | "metered_only" | "unmetered" | "settlement_failed";
    creditsCharged?: number;
    providerModel?: string;
    usage?: ReturnType<typeof normalizeModelUsage>;
    errorCode?: string;
    settledAt?: Date;
  },
) {
  const existing = await findUsageEvent(db, input);
  if (existing) return existing;

  return db.creditUsageEvent.create({
    data: {
      id: createId("creduse"),
      organizationId: input.organizationId,
      status: input.status,
      source: input.source,
      usageArea: input.usageArea,
      chargeToOrg: Boolean(input.chargeToOrg),
      idempotencyKey: input.idempotencyKey,
      ...actorFields(input.actor),
      providerModel: input.providerModel,
      inputTokens: input.usage?.inputTokens,
      outputTokens: input.usage?.outputTokens,
      cachedInputTokens: input.usage?.cachedInputTokens,
      reasoningTokens: input.usage?.reasoningTokens,
      normalizedTokens: input.usage?.normalizedTokens,
      creditsCharged: input.creditsCharged,
      pricingVersion: input.usage?.pricingVersion,
      metadata: input.metadata as Prisma.InputJsonValue | undefined,
      errorCode: input.errorCode,
      settledAt: input.settledAt,
    },
  });
}

async function updateAccountAndCreateLedger(
  db: Db,
  input: {
    organizationId: string;
    usageEventId: string;
    amountCredits: number;
    bucket: CreditGrantBucket;
    kind: "grant" | "debit";
  },
) {
  const account = await getOrCreateCreditAccount(input.organizationId, db);
  const ledgerEntries: Array<{
    id: string;
    organizationId: string;
    usageEventId: string;
    effect: "increase" | "decrease";
    bucket: CreditBucket;
    amountCredits: number;
    balanceAfterCredits: number;
  }> = [];

  let monthlyAllowanceBalanceCredits = account.monthlyAllowanceBalanceCredits;
  let walletBalanceCredits = account.walletBalanceCredits;
  let overdraftCredits = account.overdraftCredits;

  if (input.kind === "grant") {
    let remaining = input.amountCredits;
    if (overdraftCredits > 0) {
      const repaid = Math.min(overdraftCredits, remaining);
      overdraftCredits -= repaid;
      remaining -= repaid;
      ledgerEntries.push({
        id: createId("credled"),
        organizationId: input.organizationId,
        usageEventId: input.usageEventId,
        effect: "decrease",
        bucket: "overdraft",
        amountCredits: repaid,
        balanceAfterCredits: overdraftCredits,
      });
    }
    if (remaining > 0) {
      if (input.bucket === "monthly_allowance") {
        monthlyAllowanceBalanceCredits += remaining;
        ledgerEntries.push({
          id: createId("credled"),
          organizationId: input.organizationId,
          usageEventId: input.usageEventId,
          effect: "increase",
          bucket: "monthly_allowance",
          amountCredits: remaining,
          balanceAfterCredits: monthlyAllowanceBalanceCredits,
        });
      } else {
        walletBalanceCredits += remaining;
        ledgerEntries.push({
          id: createId("credled"),
          organizationId: input.organizationId,
          usageEventId: input.usageEventId,
          effect: "increase",
          bucket: "wallet",
          amountCredits: remaining,
          balanceAfterCredits: walletBalanceCredits,
        });
      }
    }
  } else {
    let remaining = input.amountCredits;
    const allowanceSpend = Math.min(monthlyAllowanceBalanceCredits, remaining);
    if (allowanceSpend > 0) {
      monthlyAllowanceBalanceCredits -= allowanceSpend;
      remaining -= allowanceSpend;
      ledgerEntries.push({
        id: createId("credled"),
        organizationId: input.organizationId,
        usageEventId: input.usageEventId,
        effect: "decrease",
        bucket: "monthly_allowance",
        amountCredits: allowanceSpend,
        balanceAfterCredits: monthlyAllowanceBalanceCredits,
      });
    }

    const walletSpend = Math.min(walletBalanceCredits, remaining);
    if (walletSpend > 0) {
      walletBalanceCredits -= walletSpend;
      remaining -= walletSpend;
      ledgerEntries.push({
        id: createId("credled"),
        organizationId: input.organizationId,
        usageEventId: input.usageEventId,
        effect: "decrease",
        bucket: "wallet",
        amountCredits: walletSpend,
        balanceAfterCredits: walletBalanceCredits,
      });
    }

    if (remaining > 0) {
      overdraftCredits += remaining;
      ledgerEntries.push({
        id: createId("credled"),
        organizationId: input.organizationId,
        usageEventId: input.usageEventId,
        effect: "increase",
        bucket: "overdraft",
        amountCredits: remaining,
        balanceAfterCredits: overdraftCredits,
      });
    }
  }

  const totalBalanceCredits = calculateTotalBalance({
    monthlyAllowanceBalanceCredits,
    walletBalanceCredits,
    overdraftCredits,
  });

  await db.creditAccount.update({
    where: { organizationId: input.organizationId },
    data: {
      monthlyAllowanceBalanceCredits,
      walletBalanceCredits,
      overdraftCredits,
      totalBalanceCredits,
    },
  });

  if (ledgerEntries.length > 0) {
    await db.creditLedgerEntry.createMany({ data: ledgerEntries });
  }
}

export async function grantCredits(
  input: UsageInput & {
    amountCredits: number;
    bucket: CreditGrantBucket;
  },
) {
  assertPositiveCredits(input.amountCredits);
  return prisma.$transaction(async (tx) => {
    const existing = await findUsageEvent(tx, input);
    if (existing) return existing;

    const event = await createUsageEvent(tx, {
      ...input,
      status: "settled",
      settledAt: new Date(),
    });
    await updateAccountAndCreateLedger(tx, {
      organizationId: input.organizationId,
      usageEventId: event.id,
      amountCredits: input.amountCredits,
      bucket: input.bucket,
      kind: "grant",
    });
    return event;
  });
}

async function debitCredits(input: UsageInput & { amountCredits: number }) {
  assertPositiveCredits(input.amountCredits);
  return prisma.$transaction(async (tx) => {
    const existing = await findUsageEvent(tx, input);
    if (existing) return existing;

    const event = await createUsageEvent(tx, {
      ...input,
      chargeToOrg: true,
      status: "settled",
      creditsCharged: input.amountCredits,
      settledAt: new Date(),
    });
    await updateAccountAndCreateLedger(tx, {
      organizationId: input.organizationId,
      usageEventId: event.id,
      amountCredits: input.amountCredits,
      bucket: "wallet",
      kind: "debit",
    });
    return event;
  });
}

/**
 * Close out the previous allowance period before a new grant. Leftover
 * allowance either expires or carries forward up to `rolloverCapCredits`, and
 * the account records the new period window either way.
 */
export async function applyAllowancePeriodReset(input: {
  organizationId: string;
  planName: string;
  periodStart: Date;
  periodEnd: Date;
  unusedPolicy: "expire" | "rollover";
  rolloverCapCredits?: number | null;
}) {
  const usageInput: UsageInput = {
    organizationId: input.organizationId,
    source: "system",
    usageArea: "monthly_allowance",
    idempotencyKey: `monthly_allowance_reset:${input.organizationId}:${input.planName}:${input.periodStart.toISOString()}`,
    metadata: {
      planName: input.planName,
      periodStart: input.periodStart.toISOString(),
      periodEnd: input.periodEnd.toISOString(),
      allowanceUnusedPolicy: input.unusedPolicy,
      rolloverCapCredits: input.rolloverCapCredits ?? null,
    },
  };

  return prisma.$transaction(async (tx) => {
    const existing = await findUsageEvent(tx, usageInput);
    if (existing) {
      return { alreadyApplied: true, expiredCredits: 0, carriedCredits: 0 };
    }

    const account = await getOrCreateCreditAccount(input.organizationId, tx);
    const leftoverCredits = account.monthlyAllowanceBalanceCredits;
    const cap = input.rolloverCapCredits;
    const carriedCredits =
      input.unusedPolicy === "rollover"
        ? typeof cap === "number"
          ? Math.min(leftoverCredits, Math.max(0, cap))
          : leftoverCredits
        : 0;
    const expiredCredits = leftoverCredits - carriedCredits;

    const event = await createUsageEvent(tx, {
      ...usageInput,
      status: "settled",
      settledAt: new Date(),
    });

    await tx.creditAccount.update({
      where: { organizationId: input.organizationId },
      data: {
        monthlyAllowanceBalanceCredits: carriedCredits,
        totalBalanceCredits: calculateTotalBalance({
          monthlyAllowanceBalanceCredits: carriedCredits,
          walletBalanceCredits: account.walletBalanceCredits,
          overdraftCredits: account.overdraftCredits,
        }),
        currentPeriodStart: input.periodStart,
        currentPeriodEnd: input.periodEnd,
      },
    });

    if (expiredCredits > 0) {
      await tx.creditLedgerEntry.createMany({
        data: [
          {
            id: createId("credled"),
            organizationId: input.organizationId,
            usageEventId: event.id,
            effect: "decrease",
            bucket: "monthly_allowance",
            amountCredits: expiredCredits,
            balanceAfterCredits: carriedCredits,
          },
        ],
      });
    }

    return { alreadyApplied: false, expiredCredits, carriedCredits };
  });
}

/**
 * Manual balance correction made by an operator. Grants land in the wallet by
 * default; debits follow the normal spend order and may create overdraft.
 */
export async function createAdminCreditAdjustment(input: {
  organizationId: string;
  amountCredits: number;
  direction: "grant" | "debit";
  reason: string;
  bucket?: CreditGrantBucket;
  actor?: CreditActor;
  idempotencyKey?: string;
  metadata?: Record<string, unknown>;
}) {
  assertPositiveCredits(input.amountCredits);

  const shared = {
    organizationId: input.organizationId,
    source: "system" as const,
    usageArea: "admin_adjustment" as const,
    actor: input.actor ?? ({ kind: "system" } as const),
    idempotencyKey:
      input.idempotencyKey ?? `admin_adjustment:${input.organizationId}:${createId("creduse")}`,
    metadata: { ...input.metadata, reason: input.reason, direction: input.direction },
  };

  if (input.direction === "grant") {
    return grantCredits({
      ...shared,
      amountCredits: input.amountCredits,
      bucket: input.bucket ?? "wallet",
    });
  }

  return debitCredits({ ...shared, amountCredits: input.amountCredits });
}

async function recordFailedUsage(input: UsageInput & { errorCode?: string }) {
  return createUsageEvent(prisma, {
    ...input,
    status: "failed",
    errorCode: input.errorCode,
  });
}

export async function recordMeteredOnlyUsage(
  input: UsageInput & {
    providerModel?: string;
    usage?: AiUsageLike;
  },
) {
  const normalized =
    input.providerModel && input.usage
      ? normalizeModelUsage({
          providerModel: input.providerModel,
          usage: input.usage,
        })
      : undefined;
  return createUsageEvent(prisma, {
    ...input,
    chargeToOrg: false,
    status: "metered_only",
    providerModel: input.providerModel,
    usage: normalized,
    creditsCharged: normalized?.creditsCharged,
  });
}

export async function listCreditActivity(input: { organizationId: string; limit?: number }) {
  return prisma.creditUsageEvent.findMany({
    where: { organizationId: input.organizationId },
    orderBy: { createdAt: "desc" },
    take: input.limit ?? 20,
    include: { ledgerEntries: { orderBy: { createdAt: "asc" } } },
  });
}

export async function runWithCreditCharge<T>(
  input: UsageInput & {
    cost: CreditCost;
    run: () => Promise<T>;
  },
): Promise<T> {
  if (!input.chargeToOrg) {
    try {
      const result = await input.run();
      await recordMeteredOnlyUsage(input);
      return result;
    } catch (err) {
      await recordFailedUsage({
        ...input,
        errorCode: err instanceof Error ? err.name : "UNKNOWN_ERROR",
      });
      throw err;
    }
  }

  await ensureOrgCanSpendCredits({
    organizationId: input.organizationId,
    chargeToOrg: true,
  });

  try {
    const result = await input.run();
    await debitCredits({ ...input, amountCredits: input.cost.credits });
    return result;
  } catch (err) {
    await recordFailedUsage({
      ...input,
      errorCode: err instanceof Error ? err.name : "UNKNOWN_ERROR",
    });
    throw err;
  }
}

export async function beginCreditUsage(input: UsageInput) {
  if (input.chargeToOrg) {
    await ensureOrgCanSpendCredits({
      organizationId: input.organizationId,
      chargeToOrg: true,
    });
  }

  return {
    async settleModelUsage(settleInput: {
      providerModel: string;
      usage?: AiUsageLike | null;
      metadata?: Record<string, unknown>;
    }) {
      if (!settleInput.usage) {
        return createUsageEvent(prisma, {
          ...input,
          metadata: { ...input.metadata, ...settleInput.metadata },
          providerModel: settleInput.providerModel,
          status: "unmetered",
        });
      }

      const normalized = normalizeModelUsage({
        providerModel: settleInput.providerModel,
        usage: settleInput.usage,
      });

      if (!input.chargeToOrg) {
        return recordMeteredOnlyUsage({
          ...input,
          metadata: { ...input.metadata, ...settleInput.metadata },
          providerModel: settleInput.providerModel,
          usage: settleInput.usage,
        });
      }

      if (normalized.creditsCharged <= 0) {
        return createUsageEvent(prisma, {
          ...input,
          metadata: { ...input.metadata, ...settleInput.metadata },
          providerModel: settleInput.providerModel,
          usage: normalized,
          creditsCharged: 0,
          status: "settled",
          settledAt: new Date(),
        });
      }

      return prisma.$transaction(async (tx) => {
        const existing = await findUsageEvent(tx, input);
        if (existing) return existing;

        const event = await createUsageEvent(tx, {
          ...input,
          metadata: { ...input.metadata, ...settleInput.metadata },
          providerModel: settleInput.providerModel,
          usage: normalized,
          creditsCharged: normalized.creditsCharged,
          status: "settled",
          settledAt: new Date(),
        });
        await updateAccountAndCreateLedger(tx, {
          organizationId: input.organizationId,
          usageEventId: event.id,
          amountCredits: normalized.creditsCharged,
          bucket: "wallet",
          kind: "debit",
        });
        return event;
      });
    },
    async markFailedWithoutCharge(
      failure?: string | { errorCode?: string; metadata?: Record<string, unknown> },
    ) {
      const errorCode =
        typeof failure === "string" ? failure : (failure?.errorCode ?? "AI_CALL_FAILED");
      const metadata =
        typeof failure === "object" ? { ...input.metadata, ...failure.metadata } : input.metadata;
      return recordFailedUsage({ ...input, metadata, errorCode });
    },
  };
}
