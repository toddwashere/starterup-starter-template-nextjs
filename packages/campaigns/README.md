# @workspace/campaigns

Optional **Campaigns** bounded context for multi-step email sequences: segment-snapshot **Campaigns**, explicit **Follow-ups**, dev-authored React Email templates, click tracking, binary unsubscribe, and Resend delivery webhooks.

Built on `@workspace/contacts`, `@workspace/email`, and `@workspace/worker-queue`.

## Dev setup

1. Set env vars (see root `.env.example`):
   - `CAMPAIGN_UNSUBSCRIBE_SECRET` — HMAC secret for preference + click tokens (min 32 chars)
   - `RESEND_API_KEY`, `EMAIL_FROM`, `NEXT_PUBLIC_WWW_URL`
   - `RESEND_WEBHOOK_SECRET` — for Resend delivery webhooks (tunnel `POST /webhooks/email/resend` to public-api)
   - `REDIS_URL` + `WORKER_QUEUE_ADAPTER=bullmq` — delayed step sends

2. Run migrations: `pnpm exec prisma migrate dev` from `packages/database`.

3. Start dashboard, www, workers, and public-api. Create a campaign sequence in the dashboard, start a run against a test segment, and confirm email delivery.

## Template authoring

1. Add a React Email component under `packages/email/src/templates/marketing/`.
2. Register it in `packages/email/src/marketing/marketing-template-registry.ts`.
3. Preview locally via `apps/email-preview`.

Dashboard step editor selects `templateKey` from the registry; subjects support merge fields (`{{firstName}}`, etc.).

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
