# Stripe Billing (Better Auth Plugin + Org Subscriptions)

**Date:** 2026-05-23  
**Status:** Approved

## Overview

Add organization-scoped subscription billing using the [`@better-auth/stripe`](https://better-auth.com/docs/plugins/stripe) plugin on the existing Better Auth stack. Stripe SDK and business logic live in `packages/billing`; `packages/auth` registers the plugin and client only. Plan definitions are stored in the database (`BillingPlan`) and loaded dynamically into the plugin. Subscription state is synced by Better Auth webhooks into a `Subscription` table; entitlements are enforced in app code via `packages/billing`.

**Outcomes:**

- Org owners/admins can upgrade, manage payment methods, and cancel via Stripe Checkout / Billing Portal.
- App features gate on plan limits (from `BillingPlan.limits` + active subscription).
- Free tier works without a Stripe subscription row.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **Integration style** | Approach 1: plugin-first hybrid (`@better-auth/stripe` + `packages/billing`) |
| **Billing entity** | Organization only (`customerType: "organization"`, `referenceId = organization.id`) |
| **Plan catalog** | Database-driven (`BillingPlan`); `subscription.plans` is `async () => …` |
| **Stripe client** | Singleton in `packages/billing`; `packages/auth` imports for plugin registration |
| **HTTP / webhooks** | Plugin routes under `/api/auth/…` (including `/api/auth/stripe/webhook`) — no separate billing webhook in v1 |
| **Side effects (v1)** | Lifecycle hooks in `packages/billing` may call `@workspace/email` directly |
| **Side effects (v2)** | Auth-layer wrappers `enqueue()` worker jobs; `packages/billing` does not depend on `@workspace/worker-queue` |
| **Subscription writes** | Better Auth plugin + webhooks only; no direct Prisma updates from apps |
| **Authorization** | `authorizeReference` + existing org roles (`billing: ["manage"]` on owner/admin) |

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│ apps/dashboard                                                   │
│  • Org settings → Billing UI                                     │
│  • authClient.subscription.* (upgrade, list, cancel, portal)   │
│  • Optional @workspace/billing wrappers for server actions       │
│  • Feature gates via requireOrgEntitlement()                     │
└───────────────┬───────────────────────────────┬─────────────────┘
                │                               │
                ▼                               ▼
┌───────────────────────────┐   ┌───────────────────────────────┐
│ packages/auth              │   │ packages/billing               │
│  • stripe() plugin reg     │◄──│  • getStripeClient()           │
│  • stripeClient() reg      │   │  • stripePluginOptions()       │
│  • /api/auth/* (existing)  │   │  • plans → DB loader           │
│  • (v2) enqueue wrappers   │   │  • authorizeOrgBilling()       │
└───────────────┬───────────┘   │  • entitlements                │
                │               │  • lifecycle hook bodies         │
                │               │  • billing-plan-repo (CRUD)    │
                │               │  • subscription-repo (read)    │
                ▼               └───────────────┬─────────────────┘
┌───────────────────────────┐                   │
│ packages/database          │◄──────────────────┘
│  auth.prisma               │
│    User.stripeCustomerId?  │  (plugin; org billing may still set on org)
│    Organization.stripeCustomerId?
│  billing.prisma (new)      │
│    BillingPlan             │  (app-owned catalog)
│    Subscription            │  (plugin-synced; read-biased repos)
└───────────────────────────┘
```

### Dependency rules

- `packages/auth` → `packages/billing` (plugin options + Stripe client only).
- `packages/billing` → `packages/database`, `packages/email`; **not** `packages/auth`, **not** `packages/worker-queue`.
- `apps/dashboard` → `packages/billing`, `@workspace/auth/client`; **not** `@workspace/database` / `@prisma/client`.

### New package: `packages/billing`

Exports (illustrative):

| Export | Purpose |
|--------|---------|
| `./stripe-client` | `getStripeClient()` — Stripe SDK v22 singleton |
| `./stripe-plugin-options` | `stripePluginOptions()` consumed by `auth.ts` |
| `./plans` | `loadPlansForStripePlugin()`, `toStripePluginPlan()` |
| `./entitlements` | `getOrgSubscription`, `getOrgLimits`, `requireOrgEntitlement` |
| `./authorize-org-billing` | `authorizeOrgBilling` for `authorizeReference` |

---

## Prisma schema

### `packages/database/prisma/auth.prisma`

Add optional plugin fields to existing Better Auth models:

```prisma
model User {
  // ...existing fields
  stripeCustomerId String?
}

model Organization {
  // ...existing fields
  stripeCustomerId String?
}
```

`User.stripeCustomerId` may remain unused in org-only v1 but keeps plugin defaults and future user-billing options open. Org customer creation uses `organization.enabled` on the Stripe plugin.

### `packages/database/prisma/billing.prisma` (new file)

#### `BillingPlan` (app-owned)

| Field | Type | Notes |
|-------|------|-------|
| `id` | String PK | `createId("bplan")` |
| `name` | String unique | Lowercase plan key passed to plugin (`"pro"`) |
| `displayName` | String | UI label |
| `stripePriceIdMonthly` | String | Required for paid plans |
| `stripePriceIdAnnual` | String? | Annual checkout |
| `stripeLookupKeyMonthly` | String? | Alternative to price ID |
| `stripeLookupKeyAnnual` | String? | Optional |
| `limits` | Json | e.g. `{ "contacts": 1000, "seats": 5 }` |
| `freeTrialDays` | Int? | Passed to plugin `freeTrial.days` |
| `seatPriceId` | String? | Per-seat add-on (future team plans) |
| `group` | String? | UI grouping |
| `isActive` | Boolean | Inactive plans excluded from plugin loader |
| `sortOrder` | Int | Pricing page order |
| `createdAt` / `updatedAt` | DateTime | |

Seed at least: `free` (no Stripe price, limits only), `pro`, and optionally `team`.

#### `Subscription` (Better Auth Stripe plugin)

Mirror [plugin schema](https://better-auth.com/docs/plugins/stripe#subscription). Plugin owns creates/updates/deletes via webhooks and subscription APIs.

| Field | Type | Notes |
|-------|------|-------|
| `id` | String PK | Plugin-generated |
| `plan` | String | Plan name from `BillingPlan.name` |
| `referenceId` | String | **Organization id** in v1 |
| `stripeCustomerId` | String? | |
| `stripeSubscriptionId` | String? | |
| `status` | String | active, trialing, canceled, … |
| `periodStart` / `periodEnd` | DateTime? | |
| `cancelAtPeriodEnd` | Boolean? | |
| `cancelAt` / `canceledAt` / `endedAt` | DateTime? | |
| `seats` | Int? | Team plans |
| `trialStart` / `trialEnd` | DateTime? | |
| `billingInterval` | String? | month / year |
| `stripeScheduleId` | String? | Pending plan change |

Configure plugin schema mapping if table/model names differ:

```ts
stripe({
  schema: {
    subscription: { modelName: "Subscription" },
  },
  // ...
});
```

**Indexes:** `@@index([referenceId])`, `@@index([stripeSubscriptionId])`, `@@index([status])`.

### Repository ownership

| Table | Repo | Write path |
|-------|------|------------|
| `BillingPlan` | `packages/billing/src/data-models/billing-plan-repo.ts` | Seed / future admin; not dashboard users in v1 |
| `Subscription` | `packages/billing/src/data-models/subscription-repo.ts` | **Read-only** in v1 (list/get for entitlements) |
| `User` / `Organization` stripe IDs | Better Auth plugin | No direct app mutation |

Add `BillingIdPrefix` (`"bplan"`) to `@workspace/common` id prefix types.

---

## Stripe plugin configuration

### Server (`packages/auth/src/auth.ts`)

```ts
import { stripe } from "@better-auth/stripe";
import { getStripeClient, stripePluginOptions } from "@workspace/billing";

plugins: [
  // ...existing plugins
  stripe(stripePluginOptions(getStripeClient())),
];
```

### Client (`packages/auth/src/auth-client.ts`)

```ts
import { stripeClient } from "@better-auth/stripe/client";

plugins: [
  // ...existing
  stripeClient({ subscription: true }),
];
```

### `stripePluginOptions()` (in `packages/billing`)

| Option | Value |
|--------|-------|
| `stripeClient` | Injected from `getStripeClient()` |
| `stripeWebhookSecret` | `process.env.STRIPE_WEBHOOK_SECRET` |
| `createCustomerOnSignUp` | `false` (org customer created on first org subscribe) |
| `organization.enabled` | `true` |
| `subscription.enabled` | `true` |
| `subscription.plans` | `async () => loadActiveBillingPlans()` |
| `subscription.authorizeReference` | `authorizeOrgBilling` |
| `subscription.requireEmailVerification` | `true` (recommended) |
| `subscription.getCheckoutSessionParams` | See [Plugin features roadmap](#plugin-features-roadmap) (v1) |
| `subscription.onSubscriptionComplete` | Welcome email (v1) |
| `subscription.onSubscriptionCancel` | Cancellation email (v1) |
| `subscription.onSubscriptionUpdate` | v1 — sync status / cancellation details |
| `subscription.onSubscriptionDeleted` | v1 — final downgrade / cleanup side effects |
| `onEvent` | v1 — `invoice.payment_failed`; v2 — worker enqueue for all payment events |

### Dynamic plans loader

```ts
export async function loadActiveBillingPlans(): Promise<StripePluginPlan[]> {
  const rows = await listActiveBillingPlans();
  return rows
    .filter((p) => p.name !== "free")
    .map(toStripePluginPlan);
}
```

`toStripePluginPlan` maps DB row → `{ name, priceId, annualDiscountPriceId, limits, freeTrial, lookupKey, … }`.

### `authorizeOrgBilling`

For `referenceId` (= org id) and actions `upgrade-subscription`, `cancel-subscription`, `restore-subscription`, `list-subscription`:

1. Load `Member` for `(userId, organizationId = referenceId)`.
2. Allow if role has `billing: ["manage"]` (owner, admin per `packages/auth/src/permissions.ts`).
3. Deny otherwise.

---

## Entitlements

### Free tier

Organizations with **no** subscription in `active` or `trialing` status use limits from the `free` `BillingPlan` row (or a constant fallback in code).

### `getOrgLimits(orgId)`

1. `subscription-repo`: latest active/trialing sub for `referenceId = orgId`.
2. If found: resolve `BillingPlan` by `subscription.plan` name → return `limits` JSON.
3. Else: return free plan limits.

### `requireOrgEntitlement(orgId, feature, amount?)`

Used in server actions / API handlers before mutating gated resources (e.g. contact create). Throws a typed billing error if over limit.

Limits keys are product-defined (e.g. `contacts`, `members`, `apiKeys`); document in seed data.

---

## Dashboard UX (v1)

**Route:** existing `apps/dashboard/app/(organization)/[org-slug]/settings/billing/page.tsx`

**`BillingPageContent` enhancements:**

| State | UI |
|-------|-----|
| Free (no active sub) | Current plan card, limits usage (from `subscription.list` limits when applicable), CTA → upgrade |
| Active / trialing | Plan name, renewal date (`formatDate`), trial end if `trialing`, limits vs usage, “Manage billing” → portal |
| Pending cancel | Banner with `cancelAt` / period end + **Restore** CTA (v1 — see roadmap) |
| Pending plan change | v1.1 — banner when `stripeScheduleId` set (roadmap) |

**Actions (client):**

- Upgrade (new sub): `authClient.subscription.upgrade({ plan, annual?, referenceId: orgId, customerType: "organization", successUrl, cancelUrl })`
- Change plan (existing sub): same API with **`subscriptionId`** from `subscription.list` (required — avoids duplicate Stripe subscriptions)
- Manage: `authClient.subscription.billingPortal({ referenceId: orgId, customerType: "organization", returnUrl })`
- Cancel: `authClient.subscription.cancel({ … })` (owner/admin only)
- Restore pending cancel: `authClient.subscription.restore({ subscriptionId, referenceId, customerType: "organization" })` (v1)

**Billing interval:** Monthly / annual toggle on upgrade when plan has `stripePriceIdAnnual` (v1).

**Permissions:** Hide billing actions unless session user has `billing:manage` on the org (reuse auth permission helpers).

Further UX items: [Plugin features roadmap](#plugin-features-roadmap).

---

## Environment variables

Add to `.env.example`:

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_test_...  # if needed for future Elements
```

Price IDs live in **`BillingPlan`** rows (seeded), not env, except for Stripe API keys.

**Local webhooks:**

```bash
stripe listen --forward-to localhost:4000/api/auth/stripe/webhook
```

---

## Webhook events (Stripe Dashboard)

**Required (plugin sync)** — per Better Auth docs:

- `checkout.session.completed`
- `customer.subscription.created`
- `customer.subscription.updated`
- `customer.subscription.deleted`

**Add in v1 (via `onEvent` in `stripePluginOptions`)**:

- `invoice.payment_failed` — dunning / payment-failed email
- `invoice.paid` — receipt or internal accounting hook (email optional in v1)

**Consider in v1.1 / v2**:

- `customer.subscription.trial_will_end` — trial ending reminder (if enabled in Stripe)

---

## Worker queue integration (v2, not v1)

Per [worker-queue design](./2026-05-22-worker-queue-pgmq-design.md): domain packages do not import `@workspace/worker-queue`.

**v2 pattern:** thin functions in `packages/auth` (or dashboard) wrap billing hook results:

```ts
onSubscriptionComplete: async (ctx) => {
  await handleSubscriptionComplete(ctx); // billing
  await enqueue("billing.subscription-active", { orgId: ctx.subscription.referenceId });
},
```

Initial events (future): `billing.subscription-active`, `billing.subscription-canceled`, `billing.invoice-paid`.

---

## Plugin features roadmap

Phased use of [`@better-auth/stripe`](https://better-auth.com/docs/plugins/stripe) beyond the minimal upgrade/cancel/portal path. Implementation order: **v1 → v1.1 → v2**; items marked **built-in** need no custom logic (document for operators and UI only).

### Built-in (do not reimplement)

| Behavior | Notes |
|----------|--------|
| Webhook signature verification | Includes async verification for Stripe SDK v22 |
| Success URL race handling | Plugin redirects through an intermediate URL so DB is updated before `successUrl` |
| One active/trialing sub per `referenceId` | Enforced by plugin |
| Trial abuse prevention | One trial per **user** across all plans; not configurable |
| Org delete with active subscription | Blocked when `organization.enabled` is true |
| Org name → Stripe customer | Synced automatically |
| Cancellation fields on `Subscription` | `cancelAtPeriodEnd`, `cancelAt`, `canceledAt`, `endedAt`, `status` synced via webhooks |

### v1 — include in first billing release

| Feature | Plugin API / config | Implementation notes |
|---------|-------------------|----------------------|
| **Restore pending cancel** | `subscription.restore` | Billing UI: “Keep subscription” when `cancelAtPeriodEnd` is true |
| **Annual vs monthly** | `annual: true` on `upgrade` | Toggle on billing/upgrade UI; requires `stripePriceIdAnnual` on `BillingPlan` |
| **`subscriptionId` on plan change** | `upgrade({ subscriptionId, plan, … })` | Load active sub from `subscription.list` before any plan switch |
| **Trial display** | `subscription.list` | Show `trialing`, `trialEnd`; use `formatDate()` |
| **Trial emails** | `freeTrial.onTrialStart` / `onTrialEnd` / `onTrialExpired` | Wire in `stripePluginOptions` from `packages/billing`; call `@workspace/email` |
| **Expanded checkout params** | `getCheckoutSessionParams` | `allow_promotion_codes`, `metadata` (`organizationId`, `planName`), optional `billing_address_collection` |
| **Lifecycle: update** | `onSubscriptionUpdate` | React to `past_due`, seat changes, `cancellation_details` from `stripeSubscription` |
| **Lifecycle: deleted** | `onSubscriptionDeleted` | Entitlements fall back to free; optional email |
| **Lifecycle: created (dashboard)** | `onSubscriptionCreated` | Subs created outside Checkout (e.g. Stripe Dashboard) |
| **Org customer metadata** | `organization.getCustomerCreateParams` | `metadata`: `orgId`, `slug` |
| **Payment failure** | `onEvent` → `invoice.payment_failed` | Dunning email (aligns with SaaS template); register event in Stripe Dashboard |
| **Invoice paid** | `onEvent` → `invoice.paid` | Log or receipt email (lightweight in v1) |
| **User delete guard** | `user.deleteUser.beforeDelete` in `auth.ts` | Reject delete if user’s Stripe customer has non-terminal subs (mirror org guard pattern in docs) |
| **List limits on billing page** | `subscription.list` | Use returned `limits` for usage vs cap display (server must still enforce) |
| **Email verification gate** | `requireEmailVerification: true` | Already decided; block checkout until verified |

### v1.1 — soon after v1

| Feature | Plugin API / config | Implementation notes |
|---------|-------------------|----------------------|
| **Deferred plan change** | `upgrade({ scheduleAtPeriodEnd: true })` | No Checkout redirect; uses Subscription Schedules |
| **Pending schedule UI** | `stripeScheduleId` on `Subscription` | Banner: “Plan changes to X on {date}”; release via new upgrade or `restore` |
| **Restore pending plan change** | `subscription.restore` | Clears schedule; keeps current plan |
| **Trial ending reminder** | Stripe `customer.subscription.trial_will_end` + `onEvent` | Email N days before trial end (if event enabled in Stripe) |

### v2 — later / platform maturity

| Feature | Plugin API / config | Implementation notes |
|---------|-------------------|----------------------|
| **Worker-backed side effects** | Wrap hooks in `packages/auth` | `enqueue("billing.*")` after billing handlers; see [Worker queue integration](#worker-queue-integration-v2-not-v1) |
| **Team seats** | `seats` on `upgrade`; `seatPriceId` on plan | Cap org members vs `seats`; show seat count on billing page |
| **Price lookup keys** | `lookupKey` / `annualDiscountLookupKey` on plans | Env-agnostic seeds (test vs prod) |
| **Per-plan proration** | `prorationBehavior` on plan config | `create_prorations` \| `always_invoice` \| `none` |
| **Checkout line items** | `lineItems` on plan | Add-ons; same billing interval as base price (Stripe constraint) |
| **Automatic tax** | `getCheckoutSessionParams` → `automatic_tax` | Requires tax registration in Stripe Dashboard |
| **Tax ID collection** | `tax_id_collection` | B2B VAT/GST |
| **Org billing email** | `stripeClient.customers.update` | Not auto-synced for orgs; settings field or post-checkout hook |
| **Checkout / portal locale** | `locale` on `upgrade` / `billingPortal` | User or org preference |
| **Plan groups** | `plan.group` / `BillingPlan.group` | Pricing page sections |
| **`disableRedirect`** | `upgrade` / `billingPortal` | Only if SPA-handled return URLs are needed |

### Explicitly not planned (plugin or product)

| Item | Reason |
|------|--------|
| User-level subscriptions (`customerType: "user"`) | Org-only product decision |
| `createCustomerOnSignUp: true` | Org customer on first subscribe is sufficient for v1 |
| Customer-only mode (no subscriptions) | Not needed |
| Multiple concurrent subs per org | Plugin does not support |
| Restore fully ended subs (`endedAt` set) | Plugin limitation |
| Usage-based / metered billing | Out of plugin scope; custom `packages/billing` later |
| Stripe Connect | Out of scope |
| One-time Payment Intents | Custom `onEvent` only if product requires |

---

## Packages / apps changes (summary)

| Area | Change |
|------|--------|
| `packages/billing` | **New** package with stripe client, plugin options, repos, entitlements |
| `packages/auth` | Add `@better-auth/stripe`, wire plugin + client; depend on `@workspace/billing` |
| `packages/database` | `auth.prisma` stripe fields; new `billing.prisma`; migration |
| `packages/common` | `BillingIdPrefix` |
| `apps/dashboard` | Billing UI, entitlement checks in gated features (incremental) |
| `pnpm-workspace` | Auto-includes new `packages/billing` |

---

## Out of scope

**v1 core (smallest shippable slice):** org upgrade, portal, cancel, entitlements, seed plans, webhook sync.

**v1 extended (same release, from roadmap):** restore, annual billing, `subscriptionId` on plan change, trial UI/hooks, expanded checkout params, extra lifecycle/`onEvent` hooks, user delete guard — see [Plugin features roadmap](#plugin-features-roadmap) § v1.

**v1.1 / v2:** `scheduleAtPeriodEnd`, seats, automatic tax, worker enqueue, locale, etc. — roadmap § v1.1 / v2.

**Not planned** (any phase): usage-based/metered billing, Stripe Connect, multiple concurrent subs per org, customer-only mode, user-level subs, restoring fully ended subs, separate `/api/billing/webhooks` route, `BillingPlan` admin UI (seed-only until later).

---

## Critical Tests

- `packages/billing/src/data-models/billing-plan-repo.test.ts`: `listActiveBillingPlans` excludes inactive; scopes by `isActive`; stable sort by `sortOrder`.
- `packages/billing/src/plans/to-stripe-plugin-plan.test.ts`: maps DB row to plugin shape; omits `freeTrial` when `freeTrialDays` null; passes `limits` through.
- `packages/billing/src/authorize-org-billing.test.ts`: allows owner/admin for manage actions; denies member; denies non-member.
- `packages/billing/src/entitlements/get-org-limits.test.ts`: returns paid plan limits when active sub exists; falls back to free plan when none; handles trialing.
- `packages/billing/src/entitlements/require-org-entitlement.test.ts`: throws when over limit; passes when under/at limit; uses correct plan for trialing vs active.
- `packages/billing/src/data-models/subscription-repo.test.ts`: `getActiveSubscriptionForOrg` returns only active/trialing for `referenceId`; returns null when canceled ended.
- `packages/auth/src/stripe-plugin-wiring.test.ts` (optional): `stripePluginOptions` returns required keys when env vars mocked; does not import circular `auth`.

**Roadmap (v1.1+)** — add when implementing that phase:

- `packages/billing/src/hooks/on-stripe-event.test.ts`: `invoice.payment_failed` triggers dunning handler; unknown events ignored.
- `packages/billing/src/plans/upgrade-params.test.ts`: plan change includes `subscriptionId` when active sub exists.
- `apps/dashboard/features/organization/ui/billing-page-content.test.ts` (optional): restore button visible only when `cancelAtPeriodEnd`; annual toggle passes `annual: true`.

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/billing`
- `pnpm test --filter @workspace/auth`
- Manual: Stripe CLI webhook forward + test Checkout upgrade for org (owner role)
- Manual: member role cannot open upgrade / cancel flows

---

## References

- [Better Auth Stripe plugin](https://better-auth.com/docs/plugins/stripe)
- [Worker queue design](./2026-05-22-worker-queue-pgmq-design.md)
- [Add data model skill](.ai/skills/add-data-model-to-database/SKILL.md)
- SaaS template plan: `plans/saas-starter-template-plan.md` (Subscription & Billing section)
