# Organization AI Credits Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build org-scoped AI credits with metering, no-charge failure semantics, monthly allowance/top-up support, and initial dashboard/AI/MCP/API integration points.

**Architecture:** Add `@workspace/credits` as the ledger and policy package. `@workspace/ai` stays billing-agnostic and returns usage facts. Billing, dashboard, workers, public API, and public MCP call credits at their boundaries.

**Tech Stack:** Prisma 7, TypeScript, Vitest, Next.js server actions/routes, Hono, Stripe via existing billing package.

**Spec:** `docs/superpowers/specs/2026-08-29-org-ai-credits-design.md`

**Status:** Complete. All tasks implemented and verified. Charging remains observe-only (`chargeToOrgDefault: false`) by design — rollout step 6 (flipping selected AI calls to `chargeToOrg: true`) is deliberately deferred until metering is proven in production.

## Global Constraints

- Credit owner is organization-scoped.
- `@workspace/ai` must not import `@workspace/credits` or `@workspace/billing`.
- Failed AI/API/MCP operations must not debit credits.
- Ledger entry movement amounts are positive integers; direction is encoded by `effect`.
- Account balances may go negative through `overdraftCredits`; total balance is allowance + wallet - overdraft.
- Persisted USD fields are integer cents and must end with `InCents`.
- Credit/token fields are integers; no decimal DB fields.
- Every Prisma model has a brief `///` description. Field comments are sparse and only for nuance.
- `packages/credits/credits.config.ts` owns credits product configuration.
- `apps/dashboard/dashboard.config.ts` owns dashboard credit UI visibility.

## Implementation snapshot

### Done

- Schema and migration: `CreditAccount`, `CreditUsageEvent`, `CreditLedgerEntry`, `CreditTopUpPurchase`, `BillingPlan.creditPolicy`.
- `@workspace/credits` package: config, errors, types, balance/usage/normalization, allowance grants, Stripe top-up fulfillment.
- Billing hooks grant monthly allowance on subscription complete and fulfill `checkout.session.completed` top-ups.
- Dashboard billing panel, top-up checkout dialog, and assistant-chat metering via `beginCreditUsage` / `settleModelUsage`.
- MCP registry wraps tools that declare `creditPolicy`. Public API helper exists. Worker `ai.example` meters when `organizationId` is present.
- Convention script: `scripts/check-credit-conventions.ts` (`pnpm check:credit-conventions`).

### Remaining

None. Rollout step 6 (flip selected AI calls to `chargeToOrg: true`) is intentionally deferred until metering is observed in production.

## Verification Evidence

Recorded 2026-08-29 on branch `feat/org-ai-credits`.

| Command | Result |
|---------|--------|
| `pnpm --filter @workspace/credits test` | 6 files, 30 tests passed |
| `pnpm --filter @workspace/billing test` | 11 files, 35 tests passed |
| `pnpm --filter @workspace/common test` | 6 files, 28 tests passed |
| `pnpm --filter @apps/public-api test` | 11 files, 41 tests passed |
| `pnpm --filter @apps/public-mcp test` | 3 files, 16 tests passed |
| `pnpm --filter @apps/workers test` | 12 files, 32 tests passed |
| `pnpm --filter @apps/dashboard test` | 46 files, 306 tests passed |
| `pnpm type-check` | 21/21 tasks successful |
| `pnpm build` | 6/6 tasks successful |
| `pnpm check:credit-conventions` | passed |
| `pnpm check:credit-pricing` | passed (9 catalog models priced) |

Pre-existing failures on this branch, unrelated to credits and left untouched:

- `@workspace/auth` — 2 failing tests (`auth-email-lifecycle.test.ts` password-reset wiring, `create-organization.test.ts` duplicate slug). Confirmed failing on a clean stash of this work.
- `@apps/dashboard` lint — `TypeError: expand is not a function` from the ESLint/Next tooling. Confirmed failing on a clean stash. Only the two Next.js apps define a `lint` script, so the credits packages are covered by `type-check` instead.

## Critical Tests

- `packages/credits/src/config.test.ts`: default policy is observe-only; ID prefixes mint `credacct_` / `creduse_` / `credled_` / `credtopup_`.
- `packages/credits/src/services/normalization.test.ts`: integer markup math; local models can be zero-cost.
- `packages/credits/src/services/usage-service.test.ts`: zero-balance blocks charged work; failed wrapped work does not debit; spend order is allowance then wallet; overdraft is allowed and repaid before wallet grants.
- `usage-service.test.ts` also covers: metered-only records no ledger; missing AI usage is unmetered with no charge; settlement is idempotent by `organizationId + idempotencyKey`; admin adjustments grant, debit, and apply once.
- `packages/credits/src/services/allowance-service.test.ts`: no grant when allowance is 0; period idempotency key is stable.
- `packages/credits/src/services/allowance-period.test.ts`: expire leftover allowance vs rollover with cap; period window written to the account; reset and grant apply once per period; downgrade to a no-allowance plan still expires.
- `packages/credits/src/services/top-up-service.test.ts`: lists configured products; fulfills wallet grants by checkout session id.
- `packages/billing/src/hooks/subscription-credits.test.ts`: subscription complete grants plan `creditPolicy` allowance.
- `packages/billing/src/hooks/credit-top-up-lifecycle.test.ts`: checkout completion grants the matching top-up product.
- `apps/public-mcp/src/tools/registry.test.ts`: successful billable tools call `runWithCreditCharge`; forbidden and failed tools do not charge.
- `apps/public-api/src/middleware/credits.test.ts`: helper attributes org + API key; failed work does not charge; no org means no credit call; caller-supplied idempotency keys are honored.
- `apps/public-api/src/routes/v1/org.test.ts`: `GET /v1/orgs/{orgId}/ping` meters against the path org and returns 402 `INSUFFICIENT_CREDITS`.
- `apps/workers/src/handlers/ai-example.test.ts`: settles model usage after success; marks failed without charge.
- `apps/dashboard/app/api/ai/chat/route.test.ts`: 402 without calling the model; failed AI marks usage failed without charging; settlement happens only after the stream finishes; metering stays observe-only.
- `apps/dashboard/features/organization/data/credit-actions.test.ts` and `features/ai-chat/data/ai-chat-credit-actions.test.ts`: UI flags gate reads; low-balance and exhausted thresholds.

---

### Task 1: Credits Package Foundation

**Files:**

- Create: `packages/credits/package.json`
- Create: `packages/credits/tsconfig.json`
- Create: `packages/credits/vitest.config.ts`
- Create: `packages/credits/credits.config.ts`
- Create: `packages/credits/src/index.ts`
- Create: `packages/credits/src/errors.ts`
- Create: `packages/credits/src/types.ts`
- Modify: `packages/common/src/create-id.ts`

**Interfaces:**

- Produces `creditsConfig`, `InsufficientCreditsError`, `CreditActor`, `CreditSource`, `CreditUsageArea`, `CreditCost`.

- [x] Write tests for config defaults and ID prefixes.
- [x] Run tests and verify they fail because package/files do not exist.
- [x] Add package scaffold, config, domain errors, public types, and credit ID prefixes.
- [x] Run `pnpm --filter @workspace/credits test` and `pnpm --filter @workspace/common test` and record evidence.

### Task 2: Balance, Ledger, And Usage Services

**Files:**

- Create: `packages/credits/src/services/balance-service.ts`
- Create: `packages/credits/src/services/usage-service.ts`
- Create: `packages/credits/src/services/normalization.ts`
- Create: `packages/credits/src/services/usage-service.test.ts` (plan originally named `credit-service.test.ts`)
- Create: `packages/credits/src/services/normalization.test.ts`
- Modify: `packages/credits/src/index.ts`

**Interfaces:**

- Produces `getOrgCreditBalance`, `ensureOrgCanSpendCredits`, `beginCreditUsage`, `runWithCreditCharge`, `settleModelUsage` (method on `beginCreditUsage`), `recordMeteredOnlyUsage`, `grantCredits`.
- Also produces `createAdminCreditAdjustment` and `applyAllowancePeriodReset`.

- [x] Write tests for account creation, insufficient balance, failed operation no debit, successful fixed debit, overdraft, incoming credits repaying overdraft, and model usage normalization.
- [x] Add tests for metered-only no debit, unmetered missing usage, and settlement idempotency.
- [x] Implement transactional account/usage/ledger services.
- [x] Implement `createAdminCreditAdjustment`.
- [x] Run `pnpm --filter @workspace/credits test` and record evidence.

### Task 3: Monthly Allowance And Stripe Top-Up APIs

**Files:**

- Create: `packages/credits/src/services/allowance-service.ts`
- Create: `packages/credits/src/services/top-up-service.ts`
- Create: `packages/credits/src/services/allowance-service.test.ts`
- Create: `packages/credits/src/services/top-up-service.test.ts`
- Modify: `packages/credits/src/index.ts`
- Modify: `packages/billing/package.json`
- Modify: `packages/billing/src/hooks/subscription-lifecycle.ts`
- Modify: `packages/billing/src/hooks/on-stripe-event.ts`
- Create: `packages/billing/src/hooks/credit-top-up-lifecycle.ts`
- Create: `packages/billing/src/hooks/credit-top-up-lifecycle.test.ts`
- Create: `packages/billing/src/hooks/subscription-credits.test.ts`

**Interfaces:**

- Produces `grantMonthlyAllowance`, `grantStripeTopUp`, `listCreditTopUpProducts`.

- [x] Write tests for monthly grant idempotency key and top-up fulfillment / webhook routing.
- [x] Write tests and implement rollover vs expiration, including writing period dates onto `CreditAccount` (`applyAllowancePeriodReset`, `allowance-period.test.ts`).
- [x] Implement allowance/top-up services and call them from billing hooks where data is available.
- [x] Run `pnpm --filter @workspace/credits test` and `pnpm --filter @workspace/billing test` and record evidence.

### Task 4: Dashboard Billing And AI Integration

**Files:**

- Create: `apps/dashboard/dashboard.config.ts`
- Create: `apps/dashboard/features/organization/data/credit-actions.ts`
- Create: `apps/dashboard/features/organization/ui/credits-panel.tsx`
- Create: `apps/dashboard/features/organization/ui/credit-top-up-dialog.tsx`
- Modify: `apps/dashboard/features/organization/ui/billing-page-content.tsx`
- Modify: `apps/dashboard/app/api/ai/chat/route.ts`
- Modify: dashboard tests for billing UI and AI route.

**Interfaces:**

- Dashboard can list balances/activity/top-up products, start top-up checkout, and settle assistant chat usage only after successful stream finish.

- [x] Write route/action tests for insufficient credits, failed AI no charge, successful AI settlement, and hidden UI flags.
- [x] Implement dashboard config, server actions, billing credits panel, top-up dialog, and AI route integration.
- [x] Implement AI chat balance display and low-balance warning behind `showInAiChat` / `showLowBalanceWarnings`.
- [x] Run dashboard targeted tests.

### Task 5: Public MCP, Public API, And Worker Helpers

**Files:**

- Modify: `apps/public-mcp/package.json`
- Modify: `apps/public-mcp/src/tools/registry.ts`
- Modify: `packages/tool-calls/src/tool-definition.ts`
- Modify: selected tool definitions with fixed credit policy metadata.
- Modify: `apps/public-api/package.json`
- Create: `apps/public-api/src/middleware/credits.ts`
- Modify: `apps/workers/package.json`
- Modify: `apps/workers/src/handlers/ai-example.ts`

**Interfaces:**

- MCP and public API can run fixed-cost credit wrappers. Workers can meter or charge AI jobs with org context.

- [x] Write tests that successful billable MCP/API helper/worker paths call credits.
- [x] Write tests that forbidden/failing MCP/API work does not charge.
- [x] Implement wrappers and package dependencies.
- [x] Wire `runPublicApiWithCredits` into at least one real public API route (`GET /v1/orgs/{orgId}/ping`).
- [x] Run targeted app tests.

### Task 6: Conventions, Validation, And Full Verification

**Files:**

- Create: `scripts/check-credit-conventions.ts` (schema naming + root config files; plan originally named `packages/credits/scripts/check-pricing.ts`)
- Add package/root scripts where needed.
- Update README or spec references if implementation diverges.

**Interfaces:**

- Developers can check pricing coverage and schema naming conventions.

- [x] Add schema/config convention checks (`pnpm check:credit-conventions`).
- [x] Add pricing coverage check (`packages/credits/scripts/check-pricing.ts`, `pnpm check:credit-pricing`).
- [x] Run package tests, lint, type-check, and build.
- [x] Fix all failures (except two pre-existing `@workspace/auth` failures and the pre-existing dashboard lint tooling error, both documented above).
- [x] Report verification evidence.
