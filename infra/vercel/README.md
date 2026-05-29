# Vercel + Supabase + Upstash

Deploy the monorepo to Vercel (Next.js apps + serverless API), Supabase (Postgres), and Upstash (Redis / QStash).

## Stack overview

| Service | Role |
|---------|------|
| **Vercel** | Hosts Next.js apps and the Hono public-api as a serverless function |
| **Supabase** | Managed Postgres — `DATABASE_URL` for Prisma |
| **Upstash Redis** | BullMQ queue backing store — `REDIS_URL` |
| **QStash / Vercel Cron** | Triggers the drain route on a schedule |

## 4 Vercel projects

| Project | Framework | Entrypoint | Notes |
|---------|-----------|------------|-------|
| `dashboard` | Next.js | `apps/dashboard` | Main app; hosts drain + cron routes |
| `www` | Next.js | `apps/www` | Marketing site |
| `public-api` | Other (Node.js) | `apps/public-api/src/vercel.ts` | Hono fetch handler; see below |
| `public-mcp` | Other (Node.js) | `apps/public-mcp/src/createFetchHandler.ts` | **Stub — see Caveat** |

### public-api serverless function

`apps/public-api/src/vercel.ts` exports `default app.fetch` (standard Hono fetch handler). In the Vercel dashboard set:

- **Framework preset:** Other
- **Root directory:** `apps/public-api`
- **Build command:** `tsc` (or leave empty and use `tsx` at runtime)
- **Output directory:** (empty — functions are source-served)

### public-mcp caveat

`StreamableHTTPServerTransport` from `@modelcontextprotocol/sdk` requires Node.js `IncomingMessage` / `ServerResponse` and is incompatible with Vercel's fetch-handler model. `createFetchHandler.ts` currently returns 501. **Recommendation:** run `public-mcp` as a long-lived service on Render, Railway, or Fly.io instead. See [infra/render/README.md](../render/README.md).

## Required env vars

See [`infra/shared/env-manifest.ts`](../shared/env-manifest.ts) for the full list. Key vars per project:

| Var | dashboard | www | public-api | public-mcp |
|-----|-----------|-----|------------|------------|
| `DATABASE_URL` | ✓ | — | ✓ | — |
| `REDIS_URL` | ✓ | — | — | — |
| `BETTER_AUTH_SECRET` | ✓ | — | — | — |
| `BETTER_AUTH_URL` | ✓ | ✓ | ✓ | ✓ |
| `CRON_SECRET` | ✓ | — | — | — |
| `NEXT_PUBLIC_*` | ✓ | ✓ | — | — |

## Supabase setup

1. Create a new Supabase project at https://supabase.com.
2. Copy **Project URL** and **Database password** → construct `DATABASE_URL`:
   ```
   postgresql://postgres:<password>@<host>:5432/postgres
   ```
3. Set `DATABASE_URL` in the Vercel env vars for `dashboard` and `public-api`.
4. Run migrations: `pnpm --filter @workspace/database db:migrate:deploy`.

## Upstash setup

1. Create a Redis database at https://upstash.com.
2. Copy the **REST URL** (or direct `rediss://` connection string) as `REDIS_URL`.
3. Set `REDIS_URL` on the `dashboard` Vercel project.

## QStash drain schedule

QStash (Upstash) calls the drain route on a cron schedule:

1. Create a QStash schedule in the Upstash console:
   - **URL:** `https://app.example.com/api/jobs/drain`
   - **Method:** POST
   - **Schedule:** `0 * * * *` (every hour) or tighter as needed
   - **Header:** `Authorization: Bearer <CRON_SECRET>`
2. Set `CRON_SECRET` in Vercel env (dashboard project).

### Vercel Cron (Pro tier alternative)

Add to `apps/dashboard/vercel.json`:

```json
{
  "crons": [
    { "path": "/api/jobs/drain", "schedule": "0 * * * *" },
    { "path": "/api/cron/cleanup-expired-sessions", "schedule": "0 2 * * *" }
  ]
}
```

Vercel Cron sends `Authorization: Bearer <VERCEL_AUTOMATION_BYPASS_SECRET>` — update `authorized()` or map the header accordingly.

## Startup credits

| Service | Program | Link |
|---------|---------|------|
| Vercel | Vercel for Startups | https://vercel.com/startups |
| Supabase | Supabase Startup Program | https://supabase.com/solutions/startups |
| Upstash | Upstash startup tier | https://upstash.com |

## Cost floor

Production (Vercel Pro + Supabase Pro + Upstash Pay-as-you-go): **~$45–90/mo**. See [infra/README.md](../README.md) for the full cost matrix.
