-- CreateEnum
CREATE TYPE "CreditUsageStatus" AS ENUM ('pending', 'settled', 'failed', 'unmetered', 'metered_only', 'settlement_failed');

-- CreateEnum
CREATE TYPE "CreditLedgerEffect" AS ENUM ('increase', 'decrease');

-- CreateEnum
CREATE TYPE "CreditBucket" AS ENUM ('monthly_allowance', 'wallet', 'overdraft');

-- AlterTable
ALTER TABLE "BillingPlan" ADD COLUMN     "creditPolicy" JSONB;

-- CreateTable
CREATE TABLE "CreditAccount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "monthlyAllowanceBalanceCredits" INTEGER NOT NULL DEFAULT 0,
    "walletBalanceCredits" INTEGER NOT NULL DEFAULT 0,
    "overdraftCredits" INTEGER NOT NULL DEFAULT 0,
    "totalBalanceCredits" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditUsageEvent" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "status" "CreditUsageStatus" NOT NULL,
    "source" TEXT NOT NULL,
    "usageArea" TEXT NOT NULL,
    "chargeToOrg" BOOLEAN NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actorKind" TEXT,
    "userId" TEXT,
    "apiKeyId" TEXT,
    "oauthClientId" TEXT,
    "providerModel" TEXT,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "cachedInputTokens" INTEGER,
    "reasoningTokens" INTEGER,
    "normalizedTokens" INTEGER,
    "creditsCharged" INTEGER,
    "providerCostInCents" INTEGER,
    "customerPriceInCents" INTEGER,
    "pricingVersion" TEXT,
    "metadata" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" TIMESTAMP(3),

    CONSTRAINT "CreditUsageEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditLedgerEntry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "usageEventId" TEXT NOT NULL,
    "effect" "CreditLedgerEffect" NOT NULL,
    "bucket" "CreditBucket" NOT NULL,
    "amountCredits" INTEGER NOT NULL,
    "balanceAfterCredits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditLedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CreditTopUpPurchase" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "topUpProductName" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeAmountPaidInCents" INTEGER,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "fulfilledAt" TIMESTAMP(3),

    CONSTRAINT "CreditTopUpPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditAccount_organizationId_key" ON "CreditAccount"("organizationId");

-- CreateIndex
CREATE INDEX "CreditAccount_totalBalanceCredits_idx" ON "CreditAccount"("totalBalanceCredits");

-- CreateIndex
CREATE INDEX "CreditUsageEvent_organizationId_createdAt_idx" ON "CreditUsageEvent"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditUsageEvent_source_usageArea_idx" ON "CreditUsageEvent"("source", "usageArea");

-- CreateIndex
CREATE INDEX "CreditUsageEvent_status_idx" ON "CreditUsageEvent"("status");

-- CreateIndex
CREATE INDEX "CreditUsageEvent_userId_idx" ON "CreditUsageEvent"("userId");

-- CreateIndex
CREATE INDEX "CreditUsageEvent_apiKeyId_idx" ON "CreditUsageEvent"("apiKeyId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditUsageEvent_organizationId_idempotencyKey_key" ON "CreditUsageEvent"("organizationId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_organizationId_createdAt_idx" ON "CreditLedgerEntry"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "CreditLedgerEntry_usageEventId_idx" ON "CreditLedgerEntry"("usageEventId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopUpPurchase_stripeCheckoutSessionId_key" ON "CreditTopUpPurchase"("stripeCheckoutSessionId");

-- CreateIndex
CREATE INDEX "CreditTopUpPurchase_organizationId_createdAt_idx" ON "CreditTopUpPurchase"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "CreditAccount" ADD CONSTRAINT "CreditAccount_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditUsageEvent" ADD CONSTRAINT "CreditUsageEvent_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditLedgerEntry" ADD CONSTRAINT "CreditLedgerEntry_usageEventId_fkey" FOREIGN KEY ("usageEventId") REFERENCES "CreditUsageEvent"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CreditTopUpPurchase" ADD CONSTRAINT "CreditTopUpPurchase_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
