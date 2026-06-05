# Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the optional Campaigns bounded context — segment snapshot **Campaigns**, explicit **Follow-ups**, dev-authored React Email templates, auto-UTM click tracking, binary unsubscribe (footer + RFC 8058), and Resend delivery webhooks — as a deletable module on top of Contacts and Email.

**Architecture:** Domain logic in `packages/campaigns` (repos + services). Marketing send/link/token utilities in `packages/email`. Prisma models in `packages/database/prisma/campaigns.prisma`. Dashboard UI under `apps/dashboard/features/campaigns/` with routes at `/[org-slug]/campaigns/…`. Public preference + click redirect on `apps/www`. Resend webhook ingress on `apps/public-api`. Step scheduling via BullMQ delayed jobs (extend `@workspace/worker-queue`).

**Tech Stack:** Prisma 7, Zod 3, Vitest 3, React Email, Resend SDK, BullMQ, Hono (`apps/public-api`), Next.js App Router (`dashboard`, `www`), Better Auth org RBAC.

**Design spec:** [`docs/superpowers/specs/2026-06-04-campaigns-design.md`](../specs/2026-06-04-campaigns-design.md)

---

## File Structure

### Create — database & IDs

| Path | Responsibility |
|------|----------------|
| `packages/database/prisma/campaigns.prisma` | All campaign models |
| `packages/database/prisma/migrations/*` | Migration SQL |

### Create — `packages/campaigns/`

| Path | Responsibility |
|------|----------------|
| `package.json`, `tsconfig.json`, `vitest.config.ts`, `keys.ts` | Package scaffold + env |
| `src/index.ts` | Public API exports |
| `src/schemas/*.ts` | Zod input/output schemas |
| `src/data-models/*-repo.ts` | Prisma access, org-scoped |
| `src/services/sequence-service.ts` | CRUD sequences + steps |
| `src/services/enrollment-service.ts` | Snapshot + follow-up enroll |
| `src/services/campaign-run-service.ts` | Start/pause campaign runs |
| `src/services/step-send-service.ts` | Send orchestration, idempotency |
| `src/services/preference-service.ts` | Unsubscribe + tokens |
| `src/services/reporting-service.ts` | Aggregates for dashboard |
| `src/services/delivery-event-service.ts` | Apply normalized webhook events |
| `src/marketing-token.ts` | Sign/verify preference + click tokens |
| `src/template-registry.ts` | Re-export allowed `templateKey`s from email |

### Create / modify — `packages/email/`

| Path | Responsibility |
|------|----------------|
| `src/marketing/merge-fields.ts` | `{{firstName}}` replacement |
| `src/marketing/rewrite-links.ts` | Wrap http(s) hrefs |
| `src/marketing/list-unsubscribe-headers.ts` | RFC 8058 headers |
| `src/marketing/send-marketing-email.ts` | Full marketing send pipeline |
| `src/marketing/marketing-template-registry.ts` | React Email registry |
| `src/templates/marketing/_components/marketing-email-layout.tsx` | CAN-SPAM footer slot |
| `src/templates/marketing/nurture-intro-email.tsx` | Starter template |
| `src/webhooks/types.ts` | `EmailDeliveryEvent`, `EmailWebhookAdapter` |
| `src/webhooks/resend/index.ts` | Resend webhook parser |
| `src/provider/types.ts` | Extend `EmailPayload` with `headers`, `metadata` |
| `src/provider/resend/index.ts` | Pass headers + tags to Resend |

### Create / modify — worker pipeline

| Path | Responsibility |
|------|----------------|
| `packages/worker-queue/src/events.ts` | 4 new events |
| `packages/worker-queue/src/client.ts` | `delayMs` option |
| `packages/worker-queue/src/types.ts` | `PublishOptions` |
| `packages/worker-queue/src/adapters/bullmq.ts` | BullMQ `delay` + `jobId` |
| `packages/worker-queue/src/adapters/sync.ts` | Record delay for tests |
| `apps/workers/src/handlers/campaigns/*.ts` | 4 handlers |
| `apps/workers/src/handlers/index.ts` | Wire handlers |

### Create — apps

| Path | Responsibility |
|------|----------------|
| `apps/public-api/src/routes/webhooks/email-resend.ts` | Webhook ingress |
| `apps/www/app/email/preferences/page.tsx` | Preference center |
| `apps/www/app/email/preferences/one-click/route.ts` | RFC 8058 POST |
| `apps/www/app/email/go/[token]/route.ts` | Click redirect |
| `apps/www/features/campaigns/public/*` | Page content + actions |
| `apps/dashboard/app/(organization)/[org-slug]/campaigns/**` | Sparse routes |
| `apps/dashboard/features/campaigns/**` | All dashboard UI |
| `apps/email-preview/emails/nurture-intro-email.tsx` | Local preview |

### Modify — wiring

| Path | Change |
|------|--------|
| `packages/common/src/create-id.ts` | `CampaignsIdPrefix` |
| `packages/auth/src/org-roles/statement.ts` | `campaign` resource |
| `packages/auth/src/org-roles/roles.ts` | Role grants |
| `packages/auth/src/org-roles/org-roles.test.ts` | Permission tests |
| `packages/routes/src/getPathFor.ts` | Campaign route helpers |
| `packages/routes/src/index.ts` | Re-export helpers |
| `apps/dashboard/app/(organization)/[org-slug]/nav-items-org.ts` | Campaigns nav |
| `packages/ui/src/components/icon-for.tsx` | `IconForCampaigns` (Mail icon) |
| `apps/dashboard/features/contacts/contact/ui/contact-detail-page-content.tsx` | Follow-up + timeline |
| `apps/dashboard/features/contacts/contact/ui/contacts-bulk-actions.tsx` | Bulk start follow-up |
| `.env.example` | New env vars |
| `packages/campaigns/README.md` | Module overview + deletion checklist |

---

## Critical Tests

- `packages/campaigns/src/services/enrollment-service.test.ts`: snapshot enrolls eligible contacts only; skips unsubscribed, missing email, duplicate active enrollment; sets `EmailCampaignRun.enrolledCount`.
- `packages/campaigns/src/services/step-send-service.test.ts`: idempotent `{enrollmentId}:{stepId}`; exits on unsubscribe mid-sequence; advances step index; enqueues next job with `delayMs`.
- `packages/campaigns/src/services/preference-service.test.ts`: unsubscribe all exits all enrollments; sequence opt-out exits one; rejects tampered tokens.
- `packages/campaigns/src/services/delivery-event-service.test.ts`: hard bounce + complaint suppress contact and exit enrollments; soft bounce logs only.
- `packages/campaigns/src/services/reporting-service.test.ts`: per-step click counts; enrollment status aggregates.
- `packages/email/src/marketing/merge-fields.test.ts`: known fields replaced; missing → empty string; no expression evaluation.
- `packages/email/src/marketing/rewrite-links.test.ts`: http/https rewritten; mailto/tel preserved.
- `packages/email/src/webhooks/resend/resend-webhook-adapter.test.ts`: maps delivered/bounced/complained; verifies Svix signature; ignores unknown events.
- `packages/worker-queue/src/client.test.ts`: `delayMs` forwarded to adapter.
- `apps/dashboard/features/campaigns/campaign/data/campaign-actions.test.ts`: RBAC gates create/send; org scoping on mutations.

---

## Task 1: Campaign ID prefixes

**Files:**
- Modify: `packages/common/src/create-id.ts`

- [ ] **Step 1: Add `CampaignsIdPrefix`**

```typescript
export type CampaignsIdPrefix =
  | "eseq"   // EmailSequence
  | "estep"  // EmailSequenceStep
  | "ecrun"  // EmailCampaignRun
  | "eenrl"  // EmailEnrollment
  | "esend"  // EmailStepSend
  | "eclk"   // EmailLinkClick
  | "edevt"  // EmailDeliveryEvent
  | "epref"  // ContactEmailPreference
  ;

export type IdPrefix =
  | AuthIdPrefix
  | ContactsIdPrefix
  | BillingIdPrefix
  | McpIdPrefix
  | AiIdPrefix
  | CampaignsIdPrefix
  | "tmp";
```

- [ ] **Step 2: Run type-check**

Run: `pnpm type-check --filter @workspace/common`  
Expected: PASS

- [ ] **Step 3: Commit**

```bash
git add packages/common/src/create-id.ts
git commit -m "feat(common): add campaigns ID prefixes"
```

---

## Task 2: Prisma schema + migration

**Files:**
- Create: `packages/database/prisma/campaigns.prisma`

- [ ] **Step 1: Add models per spec**

Create `packages/database/prisma/campaigns.prisma` with models: `EmailSequence`, `EmailSequenceStep`, `EmailCampaignRun`, `EmailEnrollment`, `EmailStepSend`, `EmailLinkClick`, `EmailDeliveryEvent`, `ContactEmailPreference`, `ContactEmailSequenceOptOut`. Include indexes from spec (`organizationId`, `sequenceId`, `contactId`, `providerMessageId`, unique `[organizationId, slug]`, composite PK on opt-out).

- [ ] **Step 2: Generate migration**

Run: `pnpm exec prisma migrate dev --name add_campaigns_domain --create-only` (from `packages/database`)  
Review SQL, then apply locally.

- [ ] **Step 3: Commit**

```bash
git add packages/database/prisma/campaigns.prisma packages/database/prisma/migrations
git commit -m "feat(database): add campaigns prisma schema"
```

---

## Task 3: `@workspace/campaigns` package scaffold

**Files:**
- Create: `packages/campaigns/package.json`, `tsconfig.json`, `vitest.config.ts`, `keys.ts`, `src/index.ts`

- [ ] **Step 1: Create package.json**

```json
{
  "name": "@workspace/campaigns",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    ".": "./src/index.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "test": "vitest run"
  },
  "dependencies": {
    "@workspace/common": "workspace:*",
    "@workspace/contacts": "workspace:*",
    "@workspace/database": "workspace:*",
    "@workspace/email": "workspace:*",
    "@workspace/worker-queue": "workspace:*",
    "zod": "^3"
  },
  "devDependencies": {
    "@workspace/test-utils": "workspace:*",
    "@workspace/tooling": "workspace:*",
    "typescript": "^5.7",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Create keys.ts**

```typescript
import { z } from "zod";

const schema = z.object({
  CAMPAIGN_UNSUBSCRIBE_SECRET: z.string().min(32).optional(),
});

export function keys() {
  return schema.parse({
    CAMPAIGN_UNSUBSCRIBE_SECRET: process.env.CAMPAIGN_UNSUBSCRIBE_SECRET,
  });
}
```

- [ ] **Step 3: Install + type-check**

Run: `pnpm install && pnpm type-check --filter @workspace/campaigns`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/campaigns
git commit -m "feat(campaigns): scaffold @workspace/campaigns package"
```

---

## Task 4: Campaign RBAC

**Files:**
- Modify: `packages/auth/src/org-roles/statement.ts`, `roles.ts`, `org-roles.test.ts`

- [ ] **Step 1: Add statement**

In `statement.ts`:

```typescript
campaign: ["read", "create", "update", "delete", "send", "manageSettings"],
```

- [ ] **Step 2: Grant roles**

In `roles.ts` — `owner` + `admin`: all campaign actions; `member`: `read` only.

- [ ] **Step 3: Add tests**

Extend `org-roles.test.ts` with campaign permission cases mirroring contact tests.

- [ ] **Step 4: Run tests**

Run: `pnpm test --filter @workspace/auth -- org-roles`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/auth/src/org-roles
git commit -m "feat(auth): add campaign org RBAC resource"
```

---

## Task 5: Worker queue — delayed enqueue + campaign events

**Files:**
- Modify: `packages/worker-queue/src/types.ts`, `client.ts`, `events.ts`, `adapters/bullmq.ts`, `adapters/sync.ts`, `client.test.ts`, `events.test.ts`, `registry.test.ts` (workers)

- [ ] **Step 1: Add `PublishOptions` to types**

```typescript
export type PublishOptions = {
  delayMs?: number;
  jobId?: string;
};

export interface QueueAdapter {
  publish(
    queue: string,
    envelope: JobEnvelope,
    options?: PublishOptions,
  ): Promise<string>;
}
```

- [ ] **Step 2: Extend `enqueue`**

```typescript
export async function enqueue<E extends EventName>(
  event: E,
  payload: EventPayload<E>,
  options?: { idempotencyKey?: string; delayMs?: number },
): Promise<string> {
  // ... existing validation ...
  return adapter.publish(keys().BULLMQ_QUEUE_NAME, envelope, {
    delayMs: options?.delayMs,
    jobId: options?.idempotencyKey,
  });
}
```

- [ ] **Step 3: BullMQ adapter**

```typescript
const job = await queue.add(envelope.event, envelope, {
  jobId: options?.jobId,
  delay: options?.delayMs,
  removeOnComplete: true,
  removeOnFail: false,
  attempts: 5,
  backoff: { type: "exponential", delay: 2000 },
});
```

- [ ] **Step 4: Add events**

```typescript
"campaign.enroll-segment": z.object({ campaignRunId: z.string() }),
"campaign.send-step": z.object({ stepSendId: z.string() }),
"campaign.schedule-next-step": z.object({ enrollmentId: z.string() }),
"email.process-delivery-events": z.object({
  provider: z.literal("resend"),
  events: z.array(
    z.object({
      type: z.enum(["delivered", "bounced", "complained"]),
      providerMessageId: z.string(),
      occurredAt: z.string(),
      recipient: z.string().optional(),
      bounceClass: z.enum(["hard", "soft"]).optional(),
      rawType: z.string().optional(),
    }),
  ),
}),
```

- [ ] **Step 5: Tests + stub handlers**

Update `client.test.ts`, `events.test.ts`. Add temporary no-op handlers in `apps/workers/src/handlers/index.ts` so registry type-checks (replace in Task 12).

Run: `pnpm test --filter @workspace/worker-queue && pnpm type-check --filter @apps/workers`

- [ ] **Step 6: Commit**

```bash
git add packages/worker-queue apps/workers/src/handlers/index.ts apps/workers/src/registry.test.ts
git commit -m "feat(worker-queue): delayed enqueue and campaign events"
```

---

## Task 6: Email marketing utilities

**Files:**
- Create: `packages/email/src/marketing/merge-fields.ts`, `merge-fields.test.ts`
- Create: `packages/email/src/marketing/rewrite-links.ts`, `rewrite-links.test.ts`
- Modify: `packages/email/src/provider/types.ts`, `packages/email/src/provider/resend/index.ts`

- [ ] **Step 1: merge-fields (TDD)**

```typescript
const MERGE_FIELD_PATTERN = /\{\{(displayName|firstName|lastName|companyName|primaryEmail|organizationName)\}\}/g;

export type MergeFieldData = {
  displayName?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  companyName?: string | null;
  primaryEmail?: string | null;
  organizationName?: string | null;
};

export function applyMergeFields(template: string, data: MergeFieldData): string {
  return template.replace(MERGE_FIELD_PATTERN, (_match, key: keyof MergeFieldData) => {
    return data[key] ?? "";
  });
}
```

Write tests first per spec critical tests.

- [ ] **Step 2: Extend EmailPayload**

```typescript
export interface EmailPayload {
  recipient: string | string[];
  subject: string;
  html: string;
  text: string;
  cc?: string | string[];
  replyTo?: string | string[];
  tags?: Array<{ name: string; value: string }>;
  headers?: Record<string, string>;
  metadata?: Record<string, string>;
}
```

Update Resend provider to map `tags` from `metadata` and pass `headers`.

- [ ] **Step 3: rewrite-links**

```typescript
export function rewriteLinksForTracking(
  html: string,
  buildRedirectUrl: (destinationUrl: string) => string,
): string {
  return html.replace(
    /href="(https?:\/\/[^"]+)"/gi,
    (_match, url: string) => `href="${buildRedirectUrl(url)}"`,
  );
}
```

Test mailto/tel are not matched (regex only http(s)).

- [ ] **Step 4: Run tests**

Run: `pnpm test --filter @workspace/email -- merge-fields rewrite-links`  
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/email/src/marketing packages/email/src/provider
git commit -m "feat(email): marketing merge fields and link rewrite"
```

---

## Task 7: Marketing templates + registry + send helper

**Files:**
- Create: `packages/email/src/templates/marketing/_components/marketing-email-layout.tsx`
- Create: `packages/email/src/templates/marketing/nurture-intro-email.tsx`
- Create: `packages/email/src/marketing/marketing-template-registry.ts`
- Create: `packages/email/src/marketing/list-unsubscribe-headers.ts`
- Create: `packages/email/src/marketing/send-marketing-email.ts`, `send-marketing-email.test.ts`
- Create: `apps/email-preview/emails/nurture-intro-email.tsx`

- [ ] **Step 1: MarketingEmailLayout**

Shared layout with org name, body slot, physical address placeholder, `unsubscribeUrl` link prop, plain-text footer mirror.

- [ ] **Step 2: NurtureIntroEmail template**

Props: `organizationName`, `bodyIntro`, `ctaUrl`, `ctaLabel`, `unsubscribeUrl`. Use merge fields in subject at send time, not in component.

- [ ] **Step 3: Registry**

```typescript
export const marketingTemplateRegistry = {
  "nurture-intro": {
    label: "Nurture intro",
    description: "Short intro with single CTA",
    component: NurtureIntroEmail,
    propsSchema: z.object({
      bodyIntro: z.string(),
      ctaUrl: z.string().url(),
      ctaLabel: z.string(),
    }),
  },
} as const;

export type MarketingTemplateKey = keyof typeof marketingTemplateRegistry;
```

- [ ] **Step 4: sendMarketingEmail**

Implement pipeline from spec: render → rewrite links (callback receives destination + returns signed token URL built by caller) → append footer if not in layout → List-Unsubscribe headers → send with metadata tags `stepSendId`, `enrollmentId`, `sequenceId`, `organizationId`.

- [ ] **Step 5: Tests**

Mock `EmailProvider`; assert headers present, links rewritten, metadata tags set.

- [ ] **Step 6: Commit**

```bash
git add packages/email apps/email-preview
git commit -m "feat(email): marketing templates and sendMarketingEmail"
```

---

## Task 8: Signed tokens (campaigns package)

**Files:**
- Create: `packages/campaigns/src/marketing-token.ts`, `marketing-token.test.ts`

- [ ] **Step 1: Implement HMAC tokens**

```typescript
import { createHmac, timingSafeEqual } from "node:crypto";
import { keys } from "../keys";

export type MarketingTokenScope = "all" | "sequence" | "click";

export type MarketingTokenPayload = {
  contactId: string;
  organizationId: string;
  scope: MarketingTokenScope;
  sequenceId?: string;
  stepSendId?: string;
  destinationUrl?: string;
  utmMedium?: string;
  utmCampaign?: string;
  utmContent?: string;
  exp: number;
};

export function signMarketingToken(payload: Omit<MarketingTokenPayload, "exp">, ttlDays = 90): string {
  const secret = keys().CAMPAIGN_UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("CAMPAIGN_UNSUBSCRIBE_SECRET is not configured");
  const exp = Math.floor(Date.now() / 1000) + ttlDays * 86400;
  const body = Buffer.from(JSON.stringify({ ...payload, exp })).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyMarketingToken(token: string): MarketingTokenPayload {
  const [body, sig] = token.split(".");
  if (!body || !sig) throw new Error("Invalid token");
  const secret = keys().CAMPAIGN_UNSUBSCRIBE_SECRET;
  if (!secret) throw new Error("CAMPAIGN_UNSUBSCRIBE_SECRET is not configured");
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
    throw new Error("Invalid token signature");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString()) as MarketingTokenPayload;
  if (payload.exp < Math.floor(Date.now() / 1000)) throw new Error("Token expired");
  return payload;
}
```

- [ ] **Step 2: Tests**

Tampered token, expired token, round-trip.

- [ ] **Step 3: Commit**

```bash
git add packages/campaigns/src/marketing-token.ts packages/campaigns/src/marketing-token.test.ts
git commit -m "feat(campaigns): signed marketing preference and click tokens"
```

---

## Task 9: Campaign repos

**Files:**
- Create: `packages/campaigns/src/schemas/*.ts`
- Create: `packages/campaigns/src/data-models/email-sequence-repo.ts` (+ test)
- Create: `packages/campaigns/src/data-models/email-enrollment-repo.ts` (+ test)
- Create: `packages/campaigns/src/data-models/email-step-send-repo.ts` (+ test)
- Create: `packages/campaigns/src/data-models/email-preference-repo.ts` (+ test)
- Create: `packages/campaigns/src/data-models/email-link-click-repo.ts`
- Create: `packages/campaigns/src/data-models/email-delivery-event-repo.ts`
- Create: `packages/campaigns/src/data-models/email-campaign-run-repo.ts`

Follow contacts repo patterns: explicit `organizationId` on every query, `createId("eseq")` etc., no generic base repo.

Export typed DTOs from repos or schemas.

- [ ] **Step 1–N: Implement repos with colocated tests**

Minimum repo functions:

- `email-sequence-repo`: CRUD sequence + steps, list by org + kind
- `email-campaign-run-repo`: create run, update status/count
- `email-enrollment-repo`: create batch, get active by contact+sequence, list by sequence/run, update status/index/nextSendAt
- `email-step-send-repo`: create pending, mark sent/delivered/failed/skipped, find by providerMessageId
- `email-preference-repo`: get/set contact preference, sequence opt-out
- `email-link-click-repo`: insert click
- `email-delivery-event-repo`: append event

- [ ] **Run tests**

Run: `pnpm test --filter @workspace/campaigns -- data-models`  
Expected: PASS

- [ ] **Commit**

```bash
git add packages/campaigns/src/data-models packages/campaigns/src/schemas
git commit -m "feat(campaigns): add data-model repos"
```

---

## Task 10: Enrollment + campaign run services

**Files:**
- Create: `packages/campaigns/src/services/enrollment-service.ts`, `enrollment-service.test.ts`
- Create: `packages/campaigns/src/services/campaign-run-service.ts`, `campaign-run-service.test.ts`

- [ ] **Step 1: enrollment-service**

```typescript
export async function enrollSegmentSnapshot(
  organizationId: string,
  campaignRunId: string,
  sequenceId: string,
  segmentId: string,
  enrolledById: string,
): Promise<{ enrolledCount: number }> {
  // 1. Load segment filters via @workspace/contacts listContactsForSegment
  // 2. Filter: primaryEmail present, subscribed, no active enrollment, no sequence opt-out
  // 3. Batch create EmailEnrollment rows with campaignRunId
  // 4. Update EmailCampaignRun.enrolledCount
  // 5. For each enrollment: create first EmailStepSend + enqueue campaign.send-step (delay from step 1)
  return { enrolledCount };
}

export async function enrollContactsInFollowUp(
  organizationId: string,
  sequenceId: string,
  contactIds: string[],
  enrolledById: string,
): Promise<{ enrolledCount: number }> {
  // Same eligibility rules; no campaignRunId
}
```

Implement critical tests from spec (mock contacts + prisma).

- [ ] **Step 2: campaign-run-service**

`startCampaignRun(orgId, sequenceId, segmentId, userId)` → create run → enqueue `campaign.enroll-segment`.  
`pauseCampaignRun`, `cancelCampaignRun` → update run + sequence status.

- [ ] **Step 3: Run tests + commit**

```bash
git add packages/campaigns/src/services/enrollment-service* packages/campaigns/src/services/campaign-run-service*
git commit -m "feat(campaigns): enrollment and campaign run services"
```

---

## Task 11: Step send + preference + reporting services

**Files:**
- Create: `packages/campaigns/src/services/step-send-service.ts`, `step-send-service.test.ts`
- Create: `packages/campaigns/src/services/preference-service.ts`, `preference-service.test.ts`
- Create: `packages/campaigns/src/services/reporting-service.ts`, `reporting-service.test.ts`
- Create: `packages/campaigns/src/services/delivery-event-service.ts`, `delivery-event-service.test.ts`

- [ ] **Step 1: step-send-service**

`executeStepSend(stepSendId)`:

1. Load step send + enrollment + step + contact + sequence; guard skip rules from spec.
2. If skip (missing email): mark skipped, exit enrollment with `missing_email`.
3. Build merge data + subject from templates.
4. Sign preference + click tokens; call `sendMarketingEmail`.
5. Mark sent, store `providerMessageId`.
6. Log `ContactInteraction` type `email`.
7. If more steps: enqueue `campaign.schedule-next-step`; else mark enrollment completed.

`scheduleNextStep(enrollmentId)`: read next step delay → enqueue `campaign.send-step` with `delayMs: delayMinutes * 60_000` and idempotencyKey.

- [ ] **Step 2: preference-service**

`unsubscribeAll(contactId, orgId)`, `unsubscribeFromSequence(contactId, sequenceId, orgId)` — update tables, exit enrollments, log interaction.

- [ ] **Step 3: reporting-service**

Per-sequence stats: enrollment counts by status, per-step sends/delivered/clicks/unsubscribes.

- [ ] **Step 4: delivery-event-service**

Apply normalized events; hard bounce/complaint → preference unsubscribed + exit enrollments.

- [ ] **Step 5: Export from index.ts + commit**

```bash
git add packages/campaigns/src/services packages/campaigns/src/index.ts
git commit -m "feat(campaigns): step send, preferences, reporting, delivery events"
```

---

## Task 12: Resend webhook adapter + public-api route

**Files:**
- Create: `packages/email/src/webhooks/types.ts`
- Create: `packages/email/src/webhooks/resend/index.ts`, `resend-webhook-adapter.test.ts`
- Modify: `packages/email/keys.ts` — add `RESEND_WEBHOOK_SECRET`
- Create: `apps/public-api/src/routes/webhooks/email-resend.ts`, `email-resend.test.ts`
- Modify: `apps/public-api/src/routes/v1/index.ts` or `app.ts` — mount webhook route **without** API key auth

- [ ] **Step 1: Webhook types**

```typescript
export type EmailDeliveryEventType = "delivered" | "bounced" | "complained";

export interface EmailDeliveryEvent {
  type: EmailDeliveryEventType;
  provider: string;
  providerMessageId: string;
  occurredAt: Date;
  recipient?: string;
  bounceClass?: "hard" | "soft";
  rawType?: string;
}

export interface EmailWebhookAdapter {
  verifyRequest(rawBody: string, headers: Record<string, string>): boolean;
  parseEvents(rawBody: string): EmailDeliveryEvent[];
}
```

- [ ] **Step 2: Resend adapter**

Use Svix headers (`svix-id`, `svix-timestamp`, `svix-signature`) + `RESEND_WEBHOOK_SECRET`. Map event types: `email.delivered`, `email.bounced`, `email.complained`.

- [ ] **Step 3: public-api route**

```typescript
// POST /webhooks/email/resend
// 1. Read raw body
// 2. verifyRequest
// 3. parseEvents
// 4. enqueue("email.process-delivery-events", { provider: "resend", events: serialized })
// 5. Return 200
```

- [ ] **Step 4: Tests + commit**

```bash
git add packages/email/src/webhooks apps/public-api/src/routes/webhooks packages/email/keys.ts
git commit -m "feat(email): Resend webhook adapter and public-api ingress"
```

---

## Task 13: Worker handlers

**Files:**
- Create: `apps/workers/src/handlers/campaigns/enroll-segment.ts`
- Create: `apps/workers/src/handlers/campaigns/send-step.ts`
- Create: `apps/workers/src/handlers/campaigns/schedule-next-step.ts`
- Create: `apps/workers/src/handlers/campaigns/process-delivery-events.ts`
- Create: colocated `*.test.ts` for each
- Modify: `apps/workers/package.json` — add `@workspace/campaigns`
- Modify: `apps/workers/src/handlers/index.ts`

- [ ] **Step 1: Handlers delegate to campaigns services**

```typescript
// send-step.ts
import { executeStepSend } from "@workspace/campaigns";

export async function handleCampaignSendStep(payload: { stepSendId: string }) {
  await executeStepSend(payload.stepSendId);
}
```

- [ ] **Step 2: Wire registry**

```typescript
"campaign.enroll-segment": handleCampaignEnrollSegment,
"campaign.send-step": handleCampaignSendStep,
"campaign.schedule-next-step": handleCampaignScheduleNextStep,
"email.process-delivery-events": handleEmailProcessDeliveryEvents,
```

- [ ] **Step 3: Update registry.test.ts + run**

Run: `pnpm test --filter @apps/workers`  
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add apps/workers
git commit -m "feat(workers): campaign email job handlers"
```

---

## Task 14: WWW public routes (preferences + click redirect)

**Files:**
- Create: `apps/www/features/campaigns/public/preference-page-content.tsx`
- Create: `apps/www/features/campaigns/public/click-redirect.ts`
- Create: `apps/www/app/email/preferences/page.tsx`
- Create: `apps/www/app/email/preferences/actions.ts` (server actions calling `@workspace/campaigns`)
- Create: `apps/www/app/email/preferences/one-click/route.ts`
- Create: `apps/www/app/email/go/[token]/route.ts`
- Modify: `apps/www/package.json` — add `@workspace/campaigns`
- Modify: `apps/www/keys.ts` — ensure `WWW_URL` or public base URL available

- [ ] **Step 1: Click redirect route**

```typescript
export async function GET(_req: Request, { params }: { params: { token: string } }) {
  const payload = verifyMarketingToken(params.token);
  if (payload.scope !== "click" || !payload.destinationUrl || !payload.stepSendId) {
    return new Response("Invalid link", { status: 400 });
  }
  await recordLinkClick(payload);
  const url = appendUtmParams(payload.destinationUrl, {
    utm_source: "email",
    utm_medium: payload.utmMedium ?? "campaign",
    utm_campaign: payload.utmCampaign ?? "",
    utm_content: payload.utmContent ?? "",
  });
  return Response.redirect(url, 302);
}
```

- [ ] **Step 2: Preference page**

Minimal public page: org name, unsubscribe all button, unsubscribe from sequence when token includes `sequenceId`. POST calls `preference-service`.

- [ ] **Step 3: One-click POST route**

RFC 8058: POST with `List-Unsubscribe=One-Click` → `unsubscribeAll`.

- [ ] **Step 4: Commit**

```bash
git add apps/www
git commit -m "feat(www): campaign email preferences and click redirect"
```

---

## Task 15: Route helpers + navigation + icon

**Files:**
- Modify: `packages/routes/src/getPathFor.ts`, `index.ts`
- Modify: `apps/dashboard/app/(organization)/[org-slug]/nav-items-org.ts`
- Modify: `packages/ui/src/components/icon-for.tsx`

- [ ] **Step 1: Route helpers**

```typescript
export function getPathForOrgCampaigns(orgSlug: string) {
  return `/${orgSlug}/campaigns`;
}
export function getPathForOrgCampaign(orgSlug: string, campaignId: string) {
  return `/${orgSlug}/campaigns/${campaignId}`;
}
export function getPathForOrgFollowUps(orgSlug: string) {
  return `/${orgSlug}/campaigns/follow-ups`;
}
export function getPathForOrgFollowUp(orgSlug: string, followUpId: string) {
  return `/${orgSlug}/campaigns/follow-ups/${followUpId}`;
}
```

- [ ] **Step 2: Nav entry**

```typescript
{
  title: "Campaigns",
  href: "/campaigns",
  icon: IconForCampaigns,
  items: [
    { title: "Campaigns", href: "/campaigns" },
    { title: "Follow-ups", href: "/campaigns/follow-ups" },
  ],
},
```

- [ ] **Step 3: IconForCampaigns**

Add using `Mail` from lucide in `icon-for.tsx` (registry only — no direct lucide import in dashboard app code).

- [ ] **Step 4: Commit**

```bash
git add packages/routes packages/ui apps/dashboard/app/(organization)/[org-slug]/nav-items-org.ts
git commit -m "feat(dashboard): campaigns nav and route helpers"
```

---

## Task 16: Dashboard — campaign routes + list/detail UI

**Files:**
- Create sparse routes under `apps/dashboard/app/(organization)/[org-slug]/campaigns/`
- Create: `apps/dashboard/features/campaigns/campaign/data/campaign-actions.ts`, `campaign-actions.test.ts`
- Create: `apps/dashboard/features/campaigns/campaign/ui/campaigns-page-content.tsx`
- Create: `apps/dashboard/features/campaigns/campaign/ui/campaign-detail-page-content.tsx`
- Create: `apps/dashboard/features/campaigns/common/ui/sequence-steps-editor.tsx`
- Create: `apps/dashboard/features/campaigns/common/ui/sequence-stats-panel.tsx`
- Modify: `apps/dashboard/package.json` — add `@workspace/campaigns`

Follow `add-new-page` skill: thin `page.tsx`, content in features.

Campaign actions (all gated with `campaign` permissions):

- `listCampaignSequencesAction` — kind `campaign`
- `createCampaignSequenceAction`, `updateCampaignSequenceAction`
- `startCampaignRunAction(segmentId)` — calls `startCampaignRun`, requires `send`
- `pauseCampaignSequenceAction`
- `sendCampaignTestEmailAction` — send step 1 to current user email

UI v1:

- Campaign list table: name, status, last run, actions
- Detail: steps editor (template dropdown from registry, subject, delay), segment picker to start run, stats panel

- [ ] **Implement + test actions**
- [ ] **Run:** `pnpm test --filter @apps/dashboard -- campaign-actions`
- [ ] **Commit**

```bash
git add apps/dashboard/features/campaigns apps/dashboard/app/(organization)/[org-slug]/campaigns
git commit -m "feat(dashboard): campaigns list and detail UI"
```

---

## Task 17: Dashboard — follow-ups + contact integration

**Files:**
- Create routes: `campaigns/follow-ups/page.tsx`, `campaigns/follow-ups/[follow-up-id]/page.tsx`
- Create: `apps/dashboard/features/campaigns/follow-up/data/follow-up-actions.ts`
- Create: `apps/dashboard/features/campaigns/follow-up/ui/follow-ups-page-content.tsx`
- Create: `apps/dashboard/features/campaigns/follow-up/ui/follow-up-detail-page-content.tsx`
- Create: `apps/dashboard/features/campaigns/contact-integration/ui/start-follow-up-button-modal.tsx`
- Modify: `contact-detail-page-content.tsx` — show active enrollments + email interactions
- Modify: `contacts-bulk-actions.tsx` — "Start follow-up" bulk action

Follow-up actions:

- `listFollowUpSequencesAction`
- `createFollowUpSequenceAction`
- `enrollContactsInFollowUpAction(contactIds)`

- [ ] **Implement UI + wire contact detail**
- [ ] **Commit**

```bash
git add apps/dashboard/features/campaigns/follow-up apps/dashboard/features/campaigns/contact-integration apps/dashboard/features/contacts
git commit -m "feat(dashboard): follow-ups and contact integration"
```

---

## Task 18: Env, docs, and verification

**Files:**
- Modify: `.env.example`
- Modify: `packages/email/keys.ts` — `RESEND_WEBHOOK_SECRET`, `EMAIL_PROVIDER`
- Create: `packages/campaigns/README.md`

- [ ] **Step 1: .env.example**

```bash
# Campaigns (optional module)
CAMPAIGN_UNSUBSCRIBE_SECRET=change-me-to-a-long-random-string
RESEND_WEBHOOK_SECRET=
EMAIL_PROVIDER=resend
```

- [ ] **Step 2: README**

Document: module purpose, dev setup (Resend + webhook tunnel), template authoring workflow, deletion checklist from spec.

- [ ] **Step 3: Full verification**

Run:

```bash
pnpm type-check
pnpm lint
pnpm test --filter @workspace/campaigns
pnpm test --filter @workspace/email
pnpm test --filter @workspace/worker-queue
pnpm test --filter @apps/workers
pnpm test --filter @apps/dashboard -- campaign
```

- [ ] **Step 4: Manual smoke test**

1. Create campaign sequence with 2 steps in dashboard.
2. Start run against a segment with one subscribed contact.
3. Confirm email received; click link → UTM on destination + `EmailLinkClick` row.
4. Unsubscribe via footer → enrollment exited.
5. POST one-click endpoint returns 200 and suppresses further sends.

- [ ] **Step 5: Commit**

```bash
git add .env.example packages/campaigns/README.md packages/email/keys.ts
git commit -m "docs(campaigns): env vars, README, and verification"
```

---

## Spec Coverage Self-Review

| Spec requirement | Task |
|------------------|------|
| packages/campaigns bounded context | 3, 9–11 |
| Extend packages/email marketing | 6–7, 12 |
| Snapshot campaign enrollment | 10 |
| Follow-up explicit enrollment | 10, 17 |
| Dev-authored React Email | 7 |
| Auto UTM + click redirect | 6, 14 |
| Binary unsubscribe + RFC 8058 | 8, 11, 14 |
| Resend webhooks delivered/bounce/complaint | 12–13 |
| Worker delayed steps | 5, 11, 13 |
| Dashboard routes `/campaigns/follow-ups` | 15–17 |
| Contact timeline integration | 11, 17 |
| Campaign RBAC | 4 |
| Deletion checklist docs | 18 |
| Resend-only v1 providers | 6–7, 12 (interfaces for future) |

No placeholder tasks remain. Type names consistent: `MarketingTokenPayload`, `EmailDeliveryEvent`, `executeStepSend`, `enrollSegmentSnapshot`.

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/campaigns`
- `pnpm test --filter @workspace/email`
- Manual smoke test (Task 18)
