# Campaigns Feature Set Design

**Date:** 2026-06-04  
**Status:** Ready for review  
**Scope:** `packages/campaigns`, `packages/email` (marketing extensions), `packages/database/prisma/campaigns.prisma`, `apps/dashboard`, `apps/www`, `apps/workers`, `packages/auth` (org RBAC)

## Overview

Add an optional **Campaigns** bounded context to the SaaS starter template. Organizations can run multi-step email **Campaigns** (segment snapshot enrollment) and **Follow-ups** (explicit contact enrollment) on top of the existing Contacts and Email infrastructure.

Campaigns share one sequence engine, one send pipeline, one link-tracking layer, and one unsubscribe system. Follow-ups are a sequence `kind`, not a separate domain. Template bodies are **developer-authored React Email** components registered in code; the dashboard configures steps (template, subject, delays) but does not provide an in-app email builder in v1.

The module is designed to be **deletable**: a starter-template adopter can remove Campaigns without gutting Contacts or transactional email.

## Goals

- Define multi-step email sequences with per-step delays.
- **Campaigns:** enroll a contact **segment snapshot** and send on a drip schedule.
- **Follow-ups:** enroll one or more contacts explicitly; show per-contact progress on the contact timeline.
- Send marketing email through the existing worker queue + provider abstraction.
- **Auto UTM** on all outbound links via a first-party click redirect (`/email/go/…`).
- Record in-app click analytics and basic campaign/follow-up reporting.
- **Binary unsubscribe** (all marketing + per-sequence) via a no-login preference page and RFC 8058 `List-Unsubscribe` headers.
- Normalize **delivery events** from email providers through a webhook adapter interface (Resend implemented in v1).
- Integrate with Contacts: segments, contact records, `ContactInteraction` timeline entries.

## Non-Goals (v1)

- In-dashboard email body editor, block builder, or user-stored HTML templates.
- Live segment sync for campaigns (snapshot only in v1).
- Topic/category email preferences.
- Reply detection, inbox sync, A/B tests, send-time optimization, timezone windows.
- Auto-enroll on stage/tag/segment change.
- MCP tools for campaigns.
- Additional sending providers beyond **Resend** (SendGrid, LuxSci, etc. are future adapters behind the same interfaces).
- Provider-native open/click tracking for campaign analytics (clicks use first-party redirect; opens deferred).
- Opportunities/deals pipeline.

## Decisions

| Topic | Decision |
|-------|----------|
| Architecture | New `packages/campaigns` + extend `packages/email` for marketing send, link rewrite, webhooks |
| Product naming | **Campaigns** (segment) + **Follow-ups** (`kind=follow_up`) |
| Enrollment | Campaigns = **segment snapshot**; follow-ups = explicit `contactId`(s) |
| Templates | Dev-authored React Email; dashboard picks `templateKey` + `subjectTemplate` |
| UTM | Auto-append on redirect; `utm_source=email`, `utm_medium=campaign\|follow_up`, `utm_campaign={sequenceSlug}`, `utm_content=step-{n}` |
| Unsubscribe | Binary: all marketing + per-sequence; no login; List-Unsubscribe + List-Unsubscribe-Post |
| Sending provider (v1) | **Resend only**; `EmailProvider` + `EmailWebhookAdapter` interfaces documented for future providers |
| Delivery tracking (v1) | Resend webhooks → `delivered`, `bounced`, `complained`; suppress on hard bounce/complaint |
| Click tracking | First-party redirect only |
| Public URLs | Recipient-facing `/email/…` paths; implementation code lives under `features/campaigns/public/` |
| Dashboard routes | `/[org-slug]/campaigns`, `/[org-slug]/campaigns/[id]`, `/[org-slug]/campaigns/follow-ups`, `/[org-slug]/campaigns/follow-ups/[id]` |

## Dependencies

- **Contacts (`@workspace/contacts`):** required. Campaigns use segments, contacts, and contact interactions. Deleting Contacts without Campaigns is fine; deleting Campaigns without Contacts is the intended optional-module story.
- **Email (`@workspace/email`):** required for render + provider.
- **Worker queue (`@workspace/worker-queue`, `apps/workers`):** required for delayed step sends and segment fan-out.
- **Auth (`@workspace/auth`):** org scoping + new `campaign` RBAC resource.

## Architecture

```text
┌─────────────────────────────────────────────────────────────────┐
│ apps/dashboard/features/campaigns/                            │
│   campaign/  follow-up/  common/  contact-integration/          │
└────────────────────────────┬────────────────────────────────────┘
                             │ server actions
┌────────────────────────────▼────────────────────────────────────┐
│ packages/campaigns                                              │
│   sequences, enrollments, preferences, reporting, repos         │
└─────┬──────────────────┬──────────────────┬─────────────────────┘
      │                  │                  │
      ▼                  ▼                  ▼
@workspace/contacts  @workspace/email   @workspace/worker-queue
      │                  │                  │
      │                  │                  └──► apps/workers/handlers/campaigns/
      │                  ├── marketing templates (React Email)
      │                  ├── sendMarketingEmail()
      │                  ├── link rewrite + List-Unsubscribe headers
      │                  └── provider/resend/ + webhooks/resend/
      │
      └── segments, contacts, ContactInteraction

apps/www/features/campaigns/public/
  ├── GET /email/preferences?token=…
  ├── POST /email/preferences/one-click?token=…   (RFC 8058)
  └── GET /email/go/[token]                       (click redirect + UTM)

apps/public-api or apps/www:
  └── POST /webhooks/email/resend                 (provider ingress)
```

### Package layout

```text
packages/campaigns/
├── src/
│   ├── index.ts
│   ├── schemas/
│   ├── data-models/           # *-repo.ts
│   ├── services/
│   │   ├── sequence-service.ts
│   │   ├── enrollment-service.ts
│   │   ├── campaign-run-service.ts
│   │   ├── step-send-service.ts
│   │   ├── preference-service.ts
│   │   └── reporting-service.ts
│   └── template-registry.ts   # re-exports allowed templateKeys + Zod copy schemas (if any)

packages/email/src/
├── marketing/
│   ├── send-marketing-email.ts
│   ├── rewrite-links.ts
│   ├── list-unsubscribe-headers.ts
│   └── merge-fields.ts
├── provider/
│   ├── types.ts               # extend EmailPayload + EmailProvider
│   └── resend/
├── webhooks/
│   ├── types.ts               # EmailDeliveryEvent, EmailWebhookAdapter
│   └── resend/
└── templates/marketing/       # dev-authored React Email components

packages/database/prisma/campaigns.prisma

apps/dashboard/
├── app/(organization)/[org-slug]/campaigns/...
└── features/campaigns/{campaign,follow-up,common,contact-integration}/

apps/www/
├── app/email/...
└── features/campaigns/public/

apps/workers/src/handlers/campaigns/
├── campaign-enroll-segment.ts
├── email-send-step.ts
└── email-schedule-next-step.ts
```

## Data Model

New file: `packages/database/prisma/campaigns.prisma`.

### EmailSequence

Multi-step sequence definition. `kind` distinguishes product surface:

- `campaign` — started from a segment snapshot (`EmailCampaignRun`).
- `follow_up` — started from explicit contact enrollment.

Fields:

- `id`, `organizationId`, `kind`, `name`, `slug` (for UTM `utm_campaign`), `status` (`draft` | `active` | `paused` | `archived`)
- `createdById`, `createdAt`, `updatedAt`

Unique: `[organizationId, slug]`.

### EmailSequenceStep

- `id`, `sequenceId`, `sortOrder`, `delayMinutes` (from previous step; step 1 uses delay from enrollment)
- `templateKey` — key in code registry
- `subjectTemplate` — supports merge fields (`{{firstName}}`, etc.)
- `templateProps Json?` — optional validated props for templates that declare editable fields in code (v1 may be unused; reserved for future hybrid copy slots)

### EmailCampaignRun

One snapshot enrollment of a campaign sequence against a segment.

- `id`, `organizationId`, `sequenceId`, `segmentId`
- `status` (`running` | `paused` | `completed` | `cancelled`)
- `enrolledCount`, `startedAt`, `completedAt?`

Snapshot rule: resolve segment at run start → create enrollments for eligible contacts only. Segment filter changes after start do **not** add/remove enrollments.

### EmailEnrollment

Per-contact participation in a sequence.

- `id`, `organizationId`, `sequenceId`, `contactId`
- `campaignRunId?` — set for campaign enrollments
- `status` (`active` | `completed` | `exited` | `paused`)
- `currentStepIndex`, `nextSendAt?`, `exitReason?` (`unsubscribed_all` | `unsubscribed_sequence` | `bounced` | `complained` | `manual` | `missing_email`)
- `enrolledAt`, `completedAt?`, `enrolledById`

Unique active constraint (enforced in service): one `active` enrollment per `(contactId, sequenceId)`.

### EmailStepSend

One send attempt for an enrollment step.

- `id`, `enrollmentId`, `stepId`, `status` (`pending` | `sent` | `delivered` | `failed` | `skipped`)
- `provider` (`resend`), `providerMessageId?`
- `sentAt?`, `deliveredAt?`, `failedAt?`, `failureReason?`
- `idempotencyKey` — worker retry safety

### EmailLinkClick

- `id`, `stepSendId`, `destinationUrl`, `utmSource`, `utmMedium`, `utmCampaign`, `utmContent`, `clickedAt`

### EmailDeliveryEvent

Append-only log of normalized provider events.

- `id`, `stepSendId?`, `provider`, `providerMessageId`, `type` (`delivered` | `bounced` | `complained`)
- `bounceClass?` (`hard` | `soft`), `occurredAt`, `rawType?`

### ContactEmailPreference

- `id`, `contactId`, `organizationId`
- `status` (`subscribed` | `unsubscribed`), `unsubscribedAt?`

### ContactEmailSequenceOptOut

Per-sequence binary opt-out (v1).

- `contactId`, `sequenceId`, `optedOutAt`
- `@@id([contactId, sequenceId])`

### Contact relation

Add optional relation from `Contact` in `contacts.prisma` only if needed for Prisma ergonomics; repositories must still pass `organizationId` explicitly.

## Merge Fields (v1)

Supported in `subjectTemplate` and template props:

- `{{displayName}}`, `{{firstName}}`, `{{lastName}}`, `{{companyName}}`, `{{primaryEmail}}`, `{{organizationName}}`

Missing values render as empty string.

## Template Registry (dev-authored)

Developers add React Email components under `packages/email/src/templates/marketing/` and register them:

```typescript
export const marketingTemplateRegistry = {
  "nurture-intro": {
    label: "Nurture intro",
    component: NurtureIntroEmail,
    propsSchema: z.object({}), // v1: no dashboard-editable props
  },
} as const;
```

Dashboard step editor:

- Select `templateKey` from registry (read-only list with labels/descriptions).
- Edit `subjectTemplate` and `delayMinutes`.
- Send test (to current user email) from sequence detail page.

Preview during development: existing `apps/email-preview` app.

## Sending Pipeline

### Marketing send helper

`packages/email/src/marketing/send-marketing-email.ts`:

1. Render React Email template + merge fields.
2. Rewrite all `http(s)` links to `{WWW_URL}/email/go/{signedToken}`.
3. Append marketing footer with preference-center link (signed token).
4. Set headers: `List-Unsubscribe`, `List-Unsubscribe-Post` (RFC 8058 one-click URL).
5. Attach provider metadata/tags: `stepSendId`, `enrollmentId`, `sequenceId`, `organizationId`.
6. Call `EmailProvider.sendEmail()`.
7. Return `{ providerMessageId }`.

Transactional emails in `packages/email` remain unchanged (no List-Unsubscribe, no link rewrite).

### Worker events

Add to `packages/worker-queue/src/events.ts`:

| Event | Payload | Handler |
|-------|---------|---------|
| `campaign.enroll-segment` | `{ campaignRunId }` | Resolve snapshot, create enrollments, enqueue first steps |
| `campaign.send-step` | `{ stepSendId }` | Render, send, record, schedule next |
| `campaign.schedule-next-step` | `{ enrollmentId }` | Compute `nextSendAt`, enqueue `campaign.send-step` with delay |
| `email.process-delivery-events` | `{ provider, events[] }` | Normalize + update step sends + suppression |

Use `idempotencyKey` on send jobs: `{enrollmentId}:{stepId}`.

### Skip / exit rules before send

Do not send when:

- Contact has no `primaryEmail`
- `ContactEmailPreference.status = unsubscribed`
- `ContactEmailSequenceOptOut` exists for this sequence
- Sequence or campaign run is `paused`/`cancelled`
- Enrollment is not `active`
- Hard bounce or complaint already recorded for contact (v1: treat as unsendable)

On skip: mark step send `skipped`, exit or advance per service rules (document: skip step and continue vs exit — **exit enrollment** on permanent suppression, **skip step** on missing email).

## Link Tracking & UTM

At render time, replace outbound links with signed redirect tokens containing:

- Destination URL
- `stepSendId`
- UTM parameters

Redirect handler (`GET /email/go/[token]`):

1. Validate signature + expiry.
2. Insert `EmailLinkClick`.
3. Redirect `302` to destination with UTM query params merged (do not overwrite existing params on destination).

## Unsubscribe & Preferences

### Tokens

Signed JWT/HMAC (org secret). Claims: `contactId`, `organizationId`, `scope` (`all` | `sequence`), optional `sequenceId`, `exp`.

Refresh token on each send (90-day expiry acceptable).

### Preference page (`GET /email/preferences`)

No auth. Shows:

- **Unsubscribe from all marketing email** for `{organizationName}`
- **Unsubscribe from {sequenceName}** when token scope includes sequence

Confirm via POST → update preference tables → exit active enrollments → log `ContactInteraction` (`type: email`, body: unsubscribed).

### RFC 8058

On marketing sends:

```http
List-Unsubscribe: <https://{WWW_URL}/email/preferences/one-click?token=…>
List-Unsubscribe-Post: List-Unsubscribe=One-Click
```

One-click POST performs the same action as “unsubscribe all” for v1 (simplest compliant default).

## Provider Abstraction

### Outbound (existing, extended)

```typescript
interface EmailPayload {
  // existing fields…
  headers?: Record<string, string>;
  metadata?: Record<string, string>; // maps to Resend tags / future custom_args
}

interface EmailProvider {
  sendEmail(payload: EmailPayload): Promise<{ id?: string }>;
}
```

v1: Resend implementation only. `EMAIL_PROVIDER=resend` default.

### Inbound (new)

```typescript
type EmailDeliveryEventType = "delivered" | "bounced" | "complained";

interface EmailDeliveryEvent {
  type: EmailDeliveryEventType;
  provider: string;
  providerMessageId: string;
  occurredAt: Date;
  recipient?: string;
  bounceClass?: "hard" | "soft";
  rawType?: string;
}

interface EmailWebhookAdapter {
  verifyRequest(req: WebhookRequest): boolean;
  parseEvents(req: WebhookRequest): EmailDeliveryEvent[];
}
```

Ingress: `POST /webhooks/email/resend` → verify Svix signature → enqueue `email.process-delivery-events`.

Matching: correlate by `providerMessageId` stored on `EmailStepSend`. Include `stepSendId` in Resend tags at send time as secondary match.

**Suppression:**

- `complained` or hard `bounced` → set contact unsendable (preference or flag), exit enrollments
- soft bounce → log on timeline; v1 does not auto-retry beyond worker defaults

Future providers (SendGrid, LuxSci) implement the same adapter; LuxSci likely needs session auth + report polling — document in `packages/email/README.md`, do not implement in v1.

## Dashboard UX

| Route | Content |
|-------|---------|
| `/[org-slug]/campaigns` | List campaign sequences + campaign runs |
| `/[org-slug]/campaigns/[id]` | Steps, start run (pick segment), pause, stats |
| `/[org-slug]/campaigns/follow-ups` | List follow-up sequences |
| `/[org-slug]/campaigns/follow-ups/[id]` | Steps, pause, stats |
| Contact detail | “Start follow-up”, active enrollments, email events on timeline |
| Contacts list bulk action | Start follow-up for selected contacts |

Navigation: single **Campaigns** sidebar entry; tabs or sub-nav for Campaigns vs Follow-ups.

### Reporting (v1)

Campaign / follow-up detail:

- Enrolled / active / completed / exited counts
- Per step: sends, delivered, failed, clicks (from `EmailLinkClick`), unsubscribes
- No open-rate dashboard in v1

Contact timeline:

- Email sent, delivered, bounced, clicked, unsubscribed (as interactions or linked views)

## RBAC

Add `campaign` resource to `packages/auth/src/org-roles/statement.ts`:

- Actions: `read`, `create`, `update`, `delete`, `send`, `manageSettings`

| Role | Permissions |
|------|-------------|
| `owner`, `admin` | all `campaign` actions |
| `member` | `read` only |

Server actions and workers acting on user intent must call `requireOrgPermissionWithActiveOrg({ campaign: ["send"] })` (or appropriate action) before enroll/send mutations.

## Worker & Env

New env vars (also `.env.example`):

| Variable | Purpose |
|----------|---------|
| `EMAIL_PROVIDER` | `resend` (default) |
| `CAMPAIGN_UNSUBSCRIBE_SECRET` | Sign preference + redirect tokens |
| `RESEND_WEBHOOK_SECRET` | Verify Resend webhook signatures |
| Existing `RESEND_API_KEY`, `EMAIL_FROM`, `WWW_URL` | Send + public links |

## Deleting the Campaigns Module

Document in spec appendix for template adopters:

1. Remove `packages/campaigns` and `campaigns.prisma`; migrate drop tables.
2. Remove `apps/dashboard/features/campaigns` and `app/.../campaigns` routes.
3. Remove `apps/www/features/campaigns` and `app/email` public routes.
4. Remove `apps/workers/src/handlers/campaigns` and worker events.
5. Remove marketing templates + webhook code from `packages/email` (keep transactional).
6. Remove nav entries + route helpers from `packages/routes`.
7. Remove `campaign` from org RBAC statement.
8. Remove env vars from `keys.ts` / `.env.example`.

Contacts and transactional email continue to work.

## Critical Tests

- `packages/campaigns/src/services/enrollment-service.test.ts`: snapshot enrolls eligible contacts only; skips unsubscribed, missing email, duplicate active enrollment; creates `EmailCampaignRun` counts.
- `packages/campaigns/src/services/step-send-service.test.ts`: idempotent send key; exits on unsubscribe mid-sequence; advances `currentStepIndex` and schedules next delay.
- `packages/campaigns/src/services/preference-service.test.ts`: unsubscribe all exits all enrollments; sequence opt-out exits one; signed token validation rejects tampered tokens.
- `packages/email/src/marketing/rewrite-links.test.ts`: rewrites http/https links; preserves mailto/tel; redirect token round-trip.
- `packages/email/src/marketing/merge-fields.test.ts`: replaces known fields; empty string for missing; does not evaluate arbitrary expressions.
- `packages/email/src/webhooks/resend/resend-webhook-adapter.test.ts`: maps delivered/bounced/complained; verifies signature; ignores unknown events.
- `packages/campaigns/src/services/reporting-service.test.ts`: per-step click counts from `EmailLinkClick`; enrollment status aggregates.
- `apps/dashboard/features/campaigns/campaign/data/campaign-actions.test.ts`: RBAC gates create/send; org scoping on all mutations.

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/campaigns`
- `pnpm test --filter @workspace/email`
- Manual: create sequence in dashboard, start campaign against test segment, receive email, click link (UTM + click row), unsubscribe via footer + one-click header path, confirm enrollment exited.

## Future Work

- Hybrid editable copy slots on fixed templates (Tier 1 user editing).
- Live segment sync for campaigns.
- SendGrid / LuxSci provider + webhook adapters.
- Topic preferences.
- Auto-enroll on segment/stage change.
- MCP tools.
- Open tracking via provider webhooks.
- In-dashboard template builder (Tier 2+).
