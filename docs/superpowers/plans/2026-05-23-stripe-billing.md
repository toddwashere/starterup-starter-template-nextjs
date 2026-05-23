# Stripe Billing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship organization-scoped Stripe subscriptions via `@better-auth/stripe`, with plan catalog in Postgres, entitlements in `packages/billing`, and a working org billing settings UI.

**Architecture:** `packages/billing` owns Stripe client, plugin options, repos, entitlements, and hook bodies. `packages/auth` registers `stripe()` + `stripeClient()` only. Schema: `stripeCustomerId` on auth models; `BillingPlan` + `Subscription` in `billing.prisma`. Dashboard calls `authClient.subscription.*` with `customerType: "organization"`.

**Tech Stack:** Better Auth 1.6+, `@better-auth/stripe`, Stripe SDK v22, Prisma 7, Vitest, Next.js 16 dashboard

**Design spec:** [`docs/superpowers/specs/2026-05-23-stripe-billing-design.md`](../specs/2026-05-23-stripe-billing-design.md)

**Key references:**
- [Better Auth Stripe plugin](https://better-auth.com/docs/plugins/stripe)
- `.ai/skills/add-data-model-to-database/SKILL.md`
- `.ai/skills/add-new-page/SKILL.md`
- `.ai/skills/add-icon/SKILL.md` (billing UI icons)

**Dependency installs:** `pnpm add` / `pnpm remove` require developer approval per workspace rules. List deps in each task; run only after approval.

---

## File Structure

### New package

```
packages/billing/
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── src/
    ├── index.ts
    ├── stripe-client.ts
    ├── stripe-plugin-options.ts
    ├── errors.ts
    ├── plans/
    │   ├── load-plans-for-stripe-plugin.ts
    │   ├── to-stripe-plugin-plan.ts
    │   └── to-stripe-plugin-plan.test.ts
    ├── authorize-org-billing.ts
    ├── authorize-org-billing.test.ts
    ├── entitlements/
    │   ├── get-org-limits.ts
    │   ├── get-org-limits.test.ts
    │   ├── require-org-entitlement.ts
    │   ├── require-org-entitlement.test.ts
    │   └── types.ts
    ├── hooks/
    │   ├── subscription-lifecycle.ts
    │   ├── on-stripe-event.ts
    │   └── on-stripe-event.test.ts
    └── data-models/
        ├── billing-plan-repo.ts
        ├── billing-plan-repo.test.ts
        ├── subscription-repo.ts
        └── subscription-repo.test.ts
```

### Database

```
packages/database/prisma/
├── auth.prisma          # + stripeCustomerId on User, Organization
└── billing.prisma       # NEW: BillingPlan, Subscription
packages/database/prisma/seed.ts   # + billing plan rows
```

### Email

```
packages/email/src/
├── send-subscription-welcome-email.ts
├── send-subscription-canceled-email.ts
├── send-payment-failed-email.ts
└── templates/
    ├── subscription-welcome-email.tsx
    ├── subscription-canceled-email.tsx
    └── payment-failed-email.tsx
```

### Auth

```
packages/auth/src/
├── auth.ts              # + stripe plugin, user.deleteUser.beforeDelete
├── auth-client.ts       # + stripeClient
└── stripe-plugin-wiring.test.ts  # optional
```

### Dashboard

```
apps/dashboard/features/organization/
├── ui/
│   ├── billing-page-content.tsx      # MODIFY — full billing UI
│   └── billing-upgrade-dialog.tsx    # NEW — plan pick + annual toggle
└── data/
    └── billing-actions.ts            # NEW — server helpers (org id, permissions)
```

### Config

```
.env.example                         # + STRIPE_* vars
packages/common/src/create-id.ts     # + "bplan" to BillingIdPrefix
```

---

## Critical Tests

- `packages/billing/src/data-models/billing-plan-repo.test.ts`: `listActiveBillingPlans` excludes inactive; stable `sortOrder`.
- `packages/billing/src/plans/to-stripe-plugin-plan.test.ts`: maps row to plugin plan; omits `freeTrial` when `freeTrialDays` null.
- `packages/billing/src/authorize-org-billing.test.ts`: owner/admin allowed; member/non-member denied.
- `packages/billing/src/entitlements/get-org-limits.test.ts`: paid limits when active/trialing sub; free when none.
- `packages/billing/src/entitlements/require-org-entitlement.test.ts`: throws when over limit; passes at limit.
- `packages/billing/src/data-models/subscription-repo.test.ts`: active/trialing only; null when ended.
- `packages/billing/src/hooks/on-stripe-event.test.ts`: routes `invoice.payment_failed`; ignores unknown types.

---

## Task 1: Prisma schema — auth fields + billing models

**Files:**
- Modify: `packages/database/prisma/auth.prisma`
- Create: `packages/database/prisma/billing.prisma`
- Modify: `packages/common/src/create-id.ts` (add `"bplan"` to `BillingIdPrefix`)

- [ ] **Step 1: Add `stripeCustomerId` to auth models**

In `auth.prisma`, add to `User` and `Organization`:

```prisma
stripeCustomerId String?
```

- [ ] **Step 2: Create `billing.prisma`**

```prisma
model BillingPlan {
  id                     String   @id
  name                   String   @unique
  displayName            String
  stripePriceIdMonthly   String   @default("")
  stripePriceIdAnnual    String?
  stripeLookupKeyMonthly String?
  stripeLookupKeyAnnual  String?
  limits                 Json
  freeTrialDays          Int?
  seatPriceId            String?
  group                  String?
  isActive               Boolean  @default(true)
  sortOrder              Int      @default(0)
  createdAt              DateTime @default(now())
  updatedAt              DateTime @updatedAt

  @@map("billing_plan")
}

model Subscription {
  id                   String    @id
  plan                 String
  referenceId          String
  stripeCustomerId     String?
  stripeSubscriptionId String?
  status               String
  periodStart          DateTime?
  periodEnd            DateTime?
  cancelAtPeriodEnd    Boolean?
  cancelAt             DateTime?
  canceledAt           DateTime?
  endedAt              DateTime?
  seats                Int?
  trialStart           DateTime?
  trialEnd             DateTime?
  billingInterval      String?
  stripeScheduleId     String?

  @@index([referenceId])
  @@index([stripeSubscriptionId])
  @@index([status])
  @@map("subscription")
}
```

- [ ] **Step 3: Add `bplan` to `BillingIdPrefix`**

```ts
export type BillingIdPrefix = "bplan" | "sub" | "price" | "prod" | "inv" | "pay";
```

- [ ] **Step 4: Run migration**

```bash
cd packages/database && pnpm db:migrate
# Name: add_stripe_billing
```

- [ ] **Step 5: Generate client**

```bash
cd packages/database && pnpm db:generate
```

- [ ] **Step 6: Commit**

```bash
git add packages/database/prisma/auth.prisma packages/database/prisma/billing.prisma packages/common/src/create-id.ts packages/database/prisma/migrations
git commit -m "feat(database): add billing schema for Stripe and BillingPlan"
```

---

## Task 2: Scaffold `packages/billing`

**Files:**
- Create: `packages/billing/package.json`, `tsconfig.json`, `vitest.config.ts`, `src/index.ts`

**Deps (request approval before install):** `stripe@^22`, `@workspace/database`, `@workspace/common`, `@workspace/email`, `zod`; dev: `vitest`, `@workspace/tooling`, `typescript`

- [ ] **Step 1: Create `package.json`**

Mirror `packages/contacts/package.json` scripts (`type-check`, `test`). Exports:

```json
{
  "exports": {
    ".": "./src/index.ts",
    "./stripe-client": "./src/stripe-client.ts",
    "./stripe-plugin-options": "./src/stripe-plugin-options.ts"
  }
}
```

- [ ] **Step 2: Add vitest config** (copy from `packages/contacts/vitest.config.ts`)

- [ ] **Step 3: Wire root turbo** — ensure `pnpm type-check` and `pnpm test` discover `@workspace/billing` (workspace glob should auto-include)

- [ ] **Step 4: Verify**

```bash
pnpm install
pnpm type-check --filter @workspace/billing
```

Expected: passes (empty package)

- [ ] **Step 5: Commit**

```bash
git add packages/billing
git commit -m "chore(billing): scaffold @workspace/billing package"
```

---

## Task 3: `billing-plan-repo` + tests

**Files:**
- Create: `packages/billing/src/data-models/billing-plan-repo.ts`
- Create: `packages/billing/src/data-models/billing-plan-repo.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    billingPlan: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "@workspace/database";
import { listActiveBillingPlans, getBillingPlanByName } from "./billing-plan-repo";

describe("billing-plan-repo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("listActiveBillingPlans excludes inactive and sorts by sortOrder", async () => {
    vi.mocked(prisma.billingPlan.findMany).mockResolvedValue([
      { name: "pro", isActive: true, sortOrder: 1 },
    ] as never);
    const rows = await listActiveBillingPlans();
    expect(prisma.billingPlan.findMany).toHaveBeenCalledWith({
      where: { isActive: true },
      orderBy: { sortOrder: "asc" },
    });
    expect(rows).toHaveLength(1);
  });

  it("getBillingPlanByName returns free plan", async () => {
    vi.mocked(prisma.billingPlan.findUnique).mockResolvedValue({
      name: "free",
      limits: { contacts: 50 },
    } as never);
    const plan = await getBillingPlanByName("free");
    expect(plan?.name).toBe("free");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

```bash
pnpm test --filter @workspace/billing -- billing-plan-repo
```

- [ ] **Step 3: Implement repo**

```ts
import { prisma } from "@workspace/database";

export async function listActiveBillingPlans() {
  return prisma.billingPlan.findMany({
    where: { isActive: true },
    orderBy: { sortOrder: "asc" },
  });
}

export async function getBillingPlanByName(name: string) {
  return prisma.billingPlan.findUnique({ where: { name } });
}
```

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

---

## Task 4: Plan mapping for Stripe plugin + tests

**Files:**
- Create: `packages/billing/src/plans/to-stripe-plugin-plan.ts`
- Create: `packages/billing/src/plans/to-stripe-plugin-plan.test.ts`
- Create: `packages/billing/src/plans/load-plans-for-stripe-plugin.ts`

- [ ] **Step 1: Write failing test for `toStripePluginPlan`**

```ts
import { describe, it, expect } from "vitest";
import { toStripePluginPlan } from "./to-stripe-plugin-plan";

const baseRow = {
  name: "pro",
  displayName: "Pro",
  stripePriceIdMonthly: "price_monthly",
  stripePriceIdAnnual: "price_annual",
  stripeLookupKeyMonthly: null,
  stripeLookupKeyAnnual: null,
  limits: { contacts: 1000 },
  freeTrialDays: null,
  seatPriceId: null,
  group: "main",
};

describe("toStripePluginPlan", () => {
  it("maps priceId and annualDiscountPriceId", () => {
    const plan = toStripePluginPlan(baseRow);
    expect(plan).toMatchObject({
      name: "pro",
      priceId: "price_monthly",
      annualDiscountPriceId: "price_annual",
      limits: { contacts: 1000 },
    });
    expect(plan.freeTrial).toBeUndefined();
  });

  it("includes freeTrial when freeTrialDays set", () => {
    const plan = toStripePluginPlan({ ...baseRow, freeTrialDays: 14 });
    expect(plan.freeTrial).toEqual({ days: 14 });
  });
});
```

- [ ] **Step 2: Implement `toStripePluginPlan`**

Map DB row → `{ name, priceId, annualDiscountPriceId?, lookupKey?, limits, freeTrial?, group?, seatPriceId? }`. Use `lookupKey` when `stripeLookupKeyMonthly` is set instead of `priceId`.

- [ ] **Step 3: Implement `loadPlansForStripePlugin`**

```ts
import { listActiveBillingPlans } from "../data-models/billing-plan-repo";
import { toStripePluginPlan } from "./to-stripe-plugin-plan";

export async function loadPlansForStripePlugin() {
  const rows = await listActiveBillingPlans();
  return rows.filter((p) => p.name !== "free").map(toStripePluginPlan);
}
```

- [ ] **Step 4: Run tests — PASS**

- [ ] **Step 5: Commit**

---

## Task 5: `subscription-repo` + tests

**Files:**
- Create: `packages/billing/src/data-models/subscription-repo.ts`
- Create: `packages/billing/src/data-models/subscription-repo.test.ts`

- [ ] **Step 1: Write failing tests**

`getActiveSubscriptionForOrg(orgId)` queries `referenceId = orgId` and `status in ('active','trialing')`, `orderBy: { periodEnd: 'desc' }`, `findFirst`.

- [ ] **Step 2: Implement (read-only)**

Do not export create/update/delete.

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

---

## Task 6: `authorizeOrgBilling` + tests

**Files:**
- Create: `packages/billing/src/authorize-org-billing.ts`
- Create: `packages/billing/src/authorize-org-billing.test.ts`

- [ ] **Step 1: Write failing tests**

Mock `prisma.member.findFirst`. Allow `owner` and `admin`; deny `member` and missing member.

- [ ] **Step 2: Implement**

```ts
import { prisma } from "@workspace/database";

const BILLING_MANAGE_ROLES = new Set(["owner", "admin"]);

export async function authorizeOrgBilling({
  user,
  referenceId,
}: {
  user: { id: string };
  referenceId: string;
  action: string;
}) {
  const member = await prisma.member.findFirst({
    where: { userId: user.id, organizationId: referenceId },
    select: { role: true },
  });
  return !!member && BILLING_MANAGE_ROLES.has(member.role);
}
```

Pass to plugin as `subscription.authorizeReference: authorizeOrgBilling`.

- [ ] **Step 3: Run tests — PASS**

- [ ] **Step 4: Commit**

---

## Task 7: Entitlements + tests

**Files:**
- Create: `packages/billing/src/entitlements/types.ts`
- Create: `packages/billing/src/entitlements/get-org-limits.ts`
- Create: `packages/billing/src/entitlements/get-org-limits.test.ts`
- Create: `packages/billing/src/entitlements/require-org-entitlement.ts`
- Create: `packages/billing/src/entitlements/require-org-entitlement.test.ts`
- Create: `packages/billing/src/errors.ts` (`BillingEntitlementError`)

- [ ] **Step 1: Define `OrgLimits` type** — `Record<string, number>` parsed from plan `limits` JSON

- [ ] **Step 2: Write failing tests for `getOrgLimits`**

Cases: active sub → pro limits; no sub → free plan limits; trialing counts as paid.

- [ ] **Step 3: Implement `getOrgLimits(orgId)`**

Use `getActiveSubscriptionForOrg` + `getBillingPlanByName(sub.plan ?? "free")`.

- [ ] **Step 4: Write failing tests for `requireOrgEntitlement(orgId, key, countUsage)`**

`countUsage` injected or passed in for testability (e.g. current contact count).

- [ ] **Step 5: Implement — throw `BillingEntitlementError` when `usage >= limits[key]`**

- [ ] **Step 6: Export from `src/index.ts`**

- [ ] **Step 7: Run tests — PASS**

- [ ] **Step 8: Commit**

---

## Task 8: Stripe client singleton

**Files:**
- Create: `packages/billing/src/stripe-client.ts`

- [ ] **Step 1: Implement**

```ts
import Stripe from "stripe";

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!client) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY is not set");
    client = new Stripe(key, {
      apiVersion: "2026-03-25.dahlia",
    });
  }
  return client;
}
```

- [ ] **Step 2: Commit**

---

## Task 9: Billing email senders + templates

**Files:**
- Create: `packages/email/src/templates/subscription-welcome-email.tsx`
- Create: `packages/email/src/templates/subscription-canceled-email.tsx`
- Create: `packages/email/src/templates/payment-failed-email.tsx`
- Create: `packages/email/src/send-subscription-welcome-email.ts`
- Create: `packages/email/src/send-subscription-canceled-email.ts`
- Create: `packages/email/src/send-payment-failed-email.ts`
- Modify: `packages/email/src/index.ts`

Follow `send-invitation-email.ts` pattern: log to console when `RESEND_API_KEY` missing.

- [ ] **Step 1: Add templates + senders**

- [ ] **Step 2: Colocated tests** (optional smoke: renders without throw)

- [ ] **Step 3: Commit**

---

## Task 10: `stripePluginOptions` + lifecycle / event hooks

**Files:**
- Create: `packages/billing/src/hooks/subscription-lifecycle.ts`
- Create: `packages/billing/src/hooks/on-stripe-event.ts`
- Create: `packages/billing/src/hooks/on-stripe-event.test.ts`
- Create: `packages/billing/src/stripe-plugin-options.ts`

- [ ] **Step 1: Write failing test for `onStripeEvent`**

`invoice.payment_failed` calls `sendPaymentFailedEmail`; other types no-op.

- [ ] **Step 2: Implement hooks**

`subscription-lifecycle.ts`:
- `handleSubscriptionComplete` → welcome email (resolve org billing contact email from member owner or Stripe customer)
- `handleSubscriptionCancel` → canceled email
- `handleSubscriptionUpdate` → log `past_due` / cancellation_details (v1 minimal)
- `handleSubscriptionDeleted` → log

`on-stripe-event.ts`: switch on `event.type`.

- [ ] **Step 3: Implement `stripePluginOptions(stripeClient)`**

```ts
export function stripePluginOptions(stripeClient: Stripe) {
  return {
    stripeClient,
    stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET!,
    createCustomerOnSignUp: false,
    organization: { enabled: true },
    schema: { subscription: { modelName: "Subscription" } },
    subscription: {
      enabled: true,
      plans: loadPlansForStripePlugin,
      authorizeReference: authorizeOrgBilling,
      requireEmailVerification: true,
      getCheckoutSessionParams: async ({ plan, subscription }) => ({
        params: {
          allow_promotion_codes: true,
          metadata: {
            organizationId: subscription?.referenceId,
            planName: plan.name,
          },
        },
      }),
      onSubscriptionComplete: handleSubscriptionComplete,
      onSubscriptionCancel: handleSubscriptionCancel,
      onSubscriptionUpdate: handleSubscriptionUpdate,
      onSubscriptionDeleted: handleSubscriptionDeleted,
      onSubscriptionCreated: handleSubscriptionComplete,
    },
    onEvent: onStripeEvent,
  };
}
```

Wire per-trial callbacks inside `toStripePluginPlan` when `freeTrialDays` set (`onTrialStart`, etc. → email stubs).

- [ ] **Step 4: Run hook tests — PASS**

- [ ] **Step 5: Commit**

---

## Task 11: Wire Better Auth server + client

**Files:**
- Modify: `packages/auth/package.json` — add `@better-auth/stripe`, `@workspace/billing`, `stripe`
- Modify: `packages/auth/src/auth.ts`
- Modify: `packages/auth/src/auth-client.ts`
- Create: `packages/auth/src/stripe-plugin-wiring.test.ts` (optional)

- [ ] **Step 1: Install deps** (after approval)

```bash
pnpm add @better-auth/stripe stripe@^22 --filter @workspace/auth
pnpm add stripe@^22 --filter @workspace/billing
pnpm add @workspace/billing --filter @workspace/auth
```

- [ ] **Step 2: Register server plugin**

```ts
import { stripe } from "@better-auth/stripe";
import { getStripeClient, stripePluginOptions } from "@workspace/billing/stripe-plugin-options";

// inside plugins array:
stripe(stripePluginOptions(getStripeClient())),
```

- [ ] **Step 3: Register client plugin**

```ts
import { stripeClient } from "@better-auth/stripe/client";
// plugins: [..., stripeClient({ subscription: true })]
```

- [ ] **Step 4: Add `user.deleteUser.beforeDelete`** (per spec — block delete if active Stripe subs on user's customer id)

Use `getStripeClient()` and list subscriptions; throw `APIError` if any non-terminal status.

- [ ] **Step 5: Verify**

```bash
pnpm type-check --filter @workspace/auth
pnpm test --filter @workspace/auth
```

- [ ] **Step 6: Commit**

---

## Task 12: Seed billing plans

**Files:**
- Modify: `packages/database/prisma/seed.ts`

- [ ] **Step 1: Upsert plans**

Use `createId("bplan")` for ids. Seed:

| name | displayName | stripePriceIdMonthly | limits | freeTrialDays |
|------|-------------|----------------------|--------|---------------|
| `free` | Free | `""` | `{ contacts: 50 }` | — |
| `pro` | Pro | `STRIPE_PRICE_PRO_MONTHLY` env or placeholder `price_xxx` | `{ contacts: 1000 }` | 14 |
| `team` | Team | optional third tier | `{ contacts: 5000, seats: 10 }` | — |

Document in seed comment: replace price IDs with real Stripe test mode IDs.

- [ ] **Step 2: Run seed**

```bash
cd packages/database && pnpm db:seed
```

- [ ] **Step 3: Commit**

---

## Task 13: Dashboard billing UI

**Files:**
- Modify: `apps/dashboard/features/organization/ui/billing-page-content.tsx`
- Create: `apps/dashboard/features/organization/ui/billing-upgrade-dialog.tsx`
- Create: `apps/dashboard/features/organization/data/billing-actions.ts`

Read `.ai/skills/add-icon/SKILL.md` for icons. Use `formatDate` from `@workspace/common`.

- [ ] **Step 1: `billing-actions.ts`**

Server module: `getBillingContextForOrg(orgSlug)` → resolves org id, calls `requireOrgPermission({ billing: ["manage"] })` for actions, returns `{ canManage, orgId }`.

- [ ] **Step 2: Billing page — load subscription client-side**

On mount (org context available):

```ts
const { data: subscriptions } = await authClient.subscription.list({
  query: { referenceId: orgId, customerType: "organization" },
});
const active = subscriptions?.find(
  (s) => s.status === "active" || s.status === "trialing",
);
```

Display: plan name, `formatDate(periodEnd)`, trial end, limits from list response, usage placeholders.

- [ ] **Step 3: Actions (only if `canManage`)**

- **Upgrade / Change plan** → `BillingUpgradeDialog` with plan list from server-fetched `BillingPlan` display names (server action `listPublicBillingPlans` in billing-actions that returns non-secret fields only — no Stripe secret keys)
- Pass `subscriptionId: active?.stripeSubscriptionId` when changing plan
- **Annual toggle** when plan has annual price
- **Manage billing** → `authClient.subscription.billingPortal({ referenceId: orgId, customerType: "organization", returnUrl })`
- **Cancel** → `authClient.subscription.cancel({ subscriptionId, referenceId, customerType: "organization", returnUrl })`
- **Restore** (when `cancelAtPeriodEnd`) → `authClient.subscription.restore({ ... })`

Success/cancel URLs: `${NEXT_PUBLIC_DASHBOARD_URL}/${orgSlug}/settings/billing`.

- [ ] **Step 4: Pending cancel banner + restore button**

- [ ] **Step 5: Hide billing CTAs for members** (no `billing:manage`)

- [ ] **Step 6: Manual smoke** (document in PR): Stripe test Checkout with CLI webhooks

- [ ] **Step 7: Commit**

---

## Task 14: Entitlement gate on contact create (example)

**Files:**
- Modify: contact create server action (find via `createContact` in `apps/dashboard/features/contacts`)

- [ ] **Step 1: Before create, call**

```ts
import { requireOrgEntitlement } from "@workspace/billing";
import { countContactsForOrg } from "@workspace/contacts"; // or existing list count

await requireOrgEntitlement(orgId, "contacts", await countContactsForOrg(orgId) + 1);
```

- [ ] **Step 2: Map `BillingEntitlementError` to user-facing action error**

- [ ] **Step 3: Commit**

---

## Task 15: Environment + docs

**Files:**
- Modify: `.env.example`
- Modify: `docs/superpowers/specs/2026-05-23-stripe-billing-design.md` — set **Status: Approved**
- Modify: `README.md` — one paragraph on Stripe setup + webhook CLI

- [ ] **Step 1: Add env vars**

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
# Optional: seed overrides
STRIPE_PRICE_PRO_MONTHLY=price_...
STRIPE_PRICE_PRO_ANNUAL=price_...
```

- [ ] **Step 2: README snippet** — link to spec, `stripe listen` command, test cards

- [ ] **Step 3: Final verification**

```bash
pnpm type-check
pnpm lint
pnpm test --filter @workspace/billing
pnpm test --filter @workspace/auth
pnpm build --filter dashboard
```

- [ ] **Step 4: Commit**

---

## Follow-up: v1.1 (separate PR after v1 merges)

Not part of this plan’s tasks; track in spec roadmap:

- [ ] `scheduleAtPeriodEnd` on upgrade UI
- [ ] Pending `stripeScheduleId` banner
- [ ] `customer.subscription.trial_will_end` webhook + email
- [ ] Tests in spec “Roadmap (v1.1+)” section

---

## Follow-up: v2 (future plan)

- Worker `enqueue` wrappers in auth for billing hooks
- Seats / `seatPriceId` enforcement vs member count
- Stripe lookup keys in seeds
- Automatic tax + tax ID collection
- Org billing email field

---

## Spec coverage self-check

| Spec section | Task |
|--------------|------|
| Plugin hybrid architecture | 2, 8, 10, 11 |
| billing.prisma + auth stripeCustomerId | 1 |
| Dynamic plans | 3, 4, 12 |
| authorizeReference | 6, 11 |
| Entitlements | 7, 14 |
| Dashboard UX + roadmap v1 | 13 |
| Webhooks / onEvent | 10, 15 (manual) |
| Email hooks | 9, 10 |
| User delete guard | 11 |
| Env vars | 15 |
| v1.1 / v2 | Follow-up sections |

---

## Manual test checklist (before merge)

- [ ] Owner upgrades org on Free → Pro via Checkout (test card `4242…`)
- [ ] Webhook updates `subscription` row; billing page shows Pro
- [ ] Billing portal opens and returns to settings
- [ ] Cancel at period end → restore works
- [ ] Plan change passes `subscriptionId` (no duplicate sub in Stripe Dashboard)
- [ ] Member role does not see upgrade/cancel
- [ ] Contact create blocked at free limit (if limit low in seed for test)
- [ ] `invoice.payment_failed` logs/sends (Stripe CLI trigger)
