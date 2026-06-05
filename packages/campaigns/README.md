# @workspace/campaigns

Optional **Campaigns** bounded context for multi-step email sequences: segment-snapshot **Campaigns**, explicit **Follow-ups**, visual or dev-authored email content, click tracking, binary unsubscribe, and Resend delivery webhooks.

Built on `@workspace/contacts`, `@workspace/email`, and `@workspace/worker-queue`.

## Dev setup

1. Set env vars (see root `.env.example`):
   - `CAMPAIGN_UNSUBSCRIBE_SECRET` — HMAC secret for preference + click tokens (min 32 chars)
   - `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_WWW_URL`
   - `RESEND_WEBHOOK_SECRET` — for Resend delivery webhooks (tunnel `POST /webhooks/email/resend` to public-api)
   - `REDIS_URL` + `WORKER_QUEUE_ADAPTER=bullmq` — delayed step sends

2. Run migrations: `pnpm exec prisma migrate dev` from `packages/database`.

3. Start dashboard, www, workers, and public-api. Create a campaign sequence in the dashboard, start a run against a test segment, and confirm email delivery.

## Email content (v2)

Each sequence step has a `contentSource`:

| Mode | Dashboard | Send pipeline |
|------|-----------|---------------|
| **editor** (default) | [@react-email/editor](https://react.email/docs/editor/overview) WYSIWYG | Stored `composedBodyHtml` wrapped in developer shell |
| **registry** | Built-in template fields | React Email body component from code registry |

**Compliance footer (developer-owned, not user-editable):**

- `MarketingEmailComplianceFooter` in `packages/email/src/templates/marketing/_components/`
- Injected for **all** marketing sends via `assembleMarketingEmail()` / `assembleMarketingEmailFromEditorHtml()`
- Includes physical address line, unsubscribe link, and plain-text footer

## Code template authoring (registry mode)

1. Add a **body-only** React Email component under `packages/email/src/templates/marketing/`.
2. Register `renderBody` in `packages/email/src/marketing/marketing-template-registry.tsx`.
3. Preview full email (with footer) via `NurtureIntroEmail` wrapper or `apps/email-preview`.

Subjects support merge fields (`{{firstName}}`, etc.) in both modes.

## Deletion checklist

To remove Campaigns without breaking Contacts or transactional email:

1. Remove `packages/campaigns` and `packages/database/prisma/campaigns.prisma`; migrate drop tables.
2. Remove `apps/dashboard/features/campaigns` and `app/.../campaigns` routes.
3. Remove `apps/www/features/campaigns` and `app/email` public routes.
4. Remove `apps/workers/src/handlers/campaigns` and campaign worker events.
5. Remove marketing templates + webhook code from `packages/email` (keep transactional).
6. Remove nav entries + route helpers from `packages/routes`.
7. Remove `campaign` from org RBAC statement in `packages/auth`.
8. Remove env vars from `keys.ts` / `.env.example`.
