# Organization AI Credits Design

**Date:** 2026-08-29  
**Status:** Draft

## Overview

Add organization-scoped AI credits that can fund dashboard AI, agents, generation, workers, public API routes, and public MCP tools. Credits are integer normalized tokens with configurable markup, monthly plan allowances, rollover or expiration policy, and Stripe hard-wallet top-ups.

The design prioritizes clean dependency direction: credit truth lives in a new `@workspace/credits` domain package. AI execution remains provider/prompt/model infrastructure. Billing handles Stripe subscriptions and checkout, then calls credits to grant allowance or top-ups. Apps and workers orchestrate credit checks and settlement at their boundaries.

## Decisions

| Topic | Decision |
|-------|----------|
| Credit owner | Organization-scoped, matching existing billing |
| Ledger package | New `@workspace/credits` package |
| AI dependency direction | `@workspace/ai` does not import credits or billing |
| Billing dependency direction | `@workspace/billing` imports credits for grants/top-ups |
| App responsibility | Dashboard/API/MCP/workers connect operation context to credits |
| Credit pools | One org pool, with transactions tagged by source and usage area |
| Balance model | Monthly allowance + hard wallet - overdraft |
| Start rule | Charged work can start when total balance is greater than zero |
| Failure rule | Failed AI/API/MCP operations do not debit credits |
| Overdraft | Successful usage may push total balance negative |
| Config | One root config file: `packages/credits/credits.config.ts` |
| Dashboard UI flag | `apps/dashboard/dashboard.config.ts` controls credit UI visibility |
| Money storage | Integer cents only; persisted USD fields end with `InCents` |
| Credit storage | Integer credits/tokens only; no decimal DB fields |

## Dependency Model

```text
@workspace/credits
  -> @workspace/database
  -> @workspace/common

@workspace/billing
  -> @workspace/credits
  -> @workspace/database
  -> Stripe

@workspace/ai
  -> @workspace/database
  -> provider SDKs

apps/dashboard, apps/public-api, apps/public-mcp, apps/workers
  -> @workspace/credits
  -> @workspace/ai or @workspace/tool-calls when needed
```

`@workspace/credits` owns balances, immutable ledger movement, usage events, policy evaluation, model usage normalization, grants, top-ups, refunds, and admin adjustments. It does not import `@workspace/ai`, `@workspace/billing`, `@workspace/auth`, app packages, worker packages, or tool packages.

`@workspace/ai` returns usage facts. It can define billing metadata on calls, but it does not mutate credit balances. This avoids making AI commercially aware and keeps workers/local development simple.

## Configuration

Credits use one obvious package-root config file:

```text
packages/credits/credits.config.ts
```

Example shape:

```ts
export const creditsConfig = {
  policy: {
    chargeToOrgDefault: false,
    allowOverdraftOnSuccessfulUsage: true,
    blockWhenBalanceCreditsLessThanOrEqualTo: 0,
    missingUsageBehavior: "record_unmetered_no_charge",
    spendOrder: ["monthly_allowance", "wallet"],
    defaultMarkupBasisPoints: 12_500,
  },
  modelPricing: {
    version: "2026-08-29",
    unknownModelBehavior: "use_default_pricing",
    defaultModel: {
      inputTokenWeight: 1,
      outputTokenWeight: 4,
      cachedInputTokenWeight: 0,
      reasoningTokenWeight: 8,
      markupBasisPoints: 12_500,
    },
    models: {
      "openai:gpt-4o-mini": {
        inputTokenWeight: 1,
        outputTokenWeight: 4,
      },
      "ollama:llama3.2": {
        inputTokenWeight: 0,
        outputTokenWeight: 0,
        cachedInputTokenWeight: 0,
        reasoningTokenWeight: 0,
        markupBasisPoints: 10_000,
      },
    },
  },
  topUpProducts: [
    {
      name: "starter_pack",
      displayName: "Starter Pack",
      credits: 100_000,
      stripePriceIdEnvVar: "STRIPE_PRICE_CREDITS_STARTER",
      isActive: true,
      sortOrder: 0,
    },
  ],
} as const;
```

`BillingPlan.creditPolicy` stores plan-specific allowance settings:

```ts
{
  monthlyAllowanceCredits: 100_000,
  allowanceUnusedPolicy: "expire" | "rollover",
  rolloverCapCredits: 50_000,
  markupBasisPoints: 12_500,
  chargeToOrgDefault: true
}
```

Dashboard-specific visibility belongs in:

```text
apps/dashboard/dashboard.config.ts
```

```ts
export const dashboardConfig = {
  features: {
    credits: {
      showInBilling: true,
      showInAiChat: true,
      showLowBalanceWarnings: true,
    },
  },
} as const;
```

## Data Model

Add `packages/database/prisma/credits.prisma` with:

- `CreditAccount`: cached org balances.
- `CreditUsageEvent`: what happened, including success/failure, source, area, actor, raw usage, normalized usage, and pricing version.
- `CreditLedgerEntry`: append-only balance movement. Amounts are positive integers; `effect` describes increase or decrease.
- `CreditTopUpPurchase`: Stripe one-time credit purchase tracking.

Extend `BillingPlan` with `creditPolicy Json?`.

Extend `Organization` relations to credit accounts/events/top-ups.

### Ledger Semantics

Ledger movement amounts are always positive integers. Do not encode debits as negative `amountCredits`.

Account balances may represent debt using `overdraftCredits` and cached `totalBalanceCredits`:

```text
totalBalanceCredits = monthlyAllowanceBalanceCredits + walletBalanceCredits - overdraftCredits
```

If a successful usage event consumes more than available allowance/wallet balance, available buckets go to zero and the remainder increases `overdraftCredits`.

Incoming credits repay overdraft first, then increase the intended bucket.

## Prisma Conventions

Every Prisma `model` must have a brief `///` description above it. Field-level `///` comments are optional and should be sparse: use them only when a field's meaning, invariant, lifecycle, or naming could be misunderstood.

Persisted USD money fields must be integer cents and end with `InCents`. Do not store dollar decimals in Prisma. Do not use `Decimal` in the credits subsystem.

Credits, tokens, and multipliers use integer fields:

- Credit counts end with `Credits`.
- Token counts end with `Tokens`.
- USD values end with `InCents`.
- Multipliers or percentages use basis points and end with `BasisPoints`.

## Core API

`@workspace/credits` exports:

```ts
getOrgCreditBalance(organizationId)
ensureOrgCanSpendCredits(input)
beginCreditUsage(input)
runWithCreditCharge(input)
settleModelUsage(input)
grantMonthlyAllowance(input)
grantStripeTopUp(input)
createAdminCreditAdjustment(input)
listCreditActivity(input)
```

Helper guarantees:

- `chargeToOrg: false` records metering only and never debits.
- Balance `<= 0` blocks charged work before execution.
- Failed operations record failed usage and create no ledger entries.
- Successful operations settle exactly once by `idempotencyKey`.
- Successful AI calls with missing usage default to unmetered/no charge.
- Settlement failures after successful work are recorded and logged loudly.

## Operation Algorithms

### Balance Precheck

Create the account if missing. If charging is disabled, pass. If charging is enabled and `totalBalanceCredits <= 0`, throw `InsufficientCreditsError`.

### Successful Debit

Create or reuse the usage event by `organizationId + idempotencyKey`. Convert model usage or fixed cost into integer credits. Spend in configured order, defaulting to monthly allowance before wallet. If the charge exceeds available balances, increase overdraft. Create one ledger row per bucket movement.

### Incoming Credits

Monthly allowance grants, Stripe top-ups, refunds, and admin grants first decrease overdraft when present. Remaining credits increase the intended bucket. All mutations are idempotent.

### Failed Usage

Failed AI/API/MCP operations create or update a failed usage event and create no ledger entries.

### Metered Only

When `chargeToOrg` resolves false, successful usage records a `metered_only` event and no ledger entries.

### Missing AI Usage

Default behavior is `record_unmetered_no_charge`: create an `unmetered` usage event, no ledger entries, and log a warning.

## Usage Normalization

Credits are normalized token units. Runtime uses integer math only:

```ts
baseNormalizedTokens =
  inputTokens * inputTokenWeight +
  outputTokens * outputTokenWeight +
  cachedInputTokens * cachedInputTokenWeight +
  reasoningTokens * reasoningTokenWeight;

creditsCharged = ceilDiv(baseNormalizedTokens * markupBasisPoints, 10_000);
```

Pricing is versioned in `credits.config.ts`, and `pricingVersion` is stored on each settled usage event. External sources such as OpenRouter, LiteLLM, and Helicone are reference data, not runtime truth. Future scripts can check or suggest pricing updates, but config changes should be reviewed in code.

## Integration Points

### Dashboard AI

Wrap `apps/dashboard/app/api/ai/chat/route.ts` around `beginCreditUsage()`. On stream finish, persist the assistant message and settle model usage. If the AI call fails, mark failed without charge.

### Workers

Wrap AI job handlers when the payload has org context. Jobs without org context default to metered-only or uncharged behavior.

### Public MCP

Wrap tool execution in `apps/public-mcp/src/tools/registry.ts` after access checks. Forbidden or failed tools do not charge. Successful billable tools charge fixed credits or future model-derived usage. Existing MCP audit logging remains separate.

### Public API

Add route-level helpers for billable endpoints. Resolve auth/org context first, then precheck and settle credits around the handler. API errors use the existing response style and a clear `INSUFFICIENT_CREDITS` code.

### Billing And Stripe

`@workspace/billing` calls `@workspace/credits` from subscription lifecycle hooks and Stripe top-up fulfillment. Dashboard billing admins can purchase top-up products through Stripe Checkout.

## UI

Extend the existing org billing page with credit balance, allowance/wallet split, overdraft warning, renewal date, top-up actions, and recent activity. Gate this UI with `dashboardConfig.features.credits.showInBilling`.

Add optional AI chat balance display and low-balance warning behind `dashboardConfig.features.credits.showInAiChat` and `showLowBalanceWarnings`.

## Testing

Core package tests cover account creation, idempotent grants, rollover/expiration, top-up fulfillment, spend order, overdraft, blocking at zero balance, no charge on failures, metered-only usage, unmetered missing usage, positive ledger amounts, and balance invariants.

Integration tests cover dashboard AI settlement, MCP wrapper charging, public API fixed-cost helpers, Stripe webhook idempotency, and dashboard feature flags.

Convention tests should verify:

- `packages/credits/credits.config.ts` exists.
- `apps/dashboard/dashboard.config.ts` exists when credit UI is implemented.
- Credits schema has no `Decimal` fields.
- Persisted USD fields end with `InCents`.
- Every Prisma model has a `///` description.

## Rollout

1. Add schema and `@workspace/credits` with `chargeToOrgDefault: false`.
2. Meter dashboard AI usage as `metered_only`.
3. Add billing-page credit UI behind dashboard config.
4. Add Stripe top-ups.
5. Add monthly allowance grants and rollover/expiration.
6. Flip selected AI calls to charged behavior.
7. Add MCP/API fixed-cost charging after dashboard AI is proven.

