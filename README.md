# Starter-Up Starter Template w/ Nextjs

A production-ready SaaS starter template built with [Superpowers](https://github.com/obra/superpowers) for agentic AI development.

## Prerequisites

- **Node.js** 24.16+ LTS ([`.nvmrc`](.nvmrc) pins `24.16.0`)
- **pnpm** 11.1.3+ (via [Corepack](https://nodejs.org/api/corepack.html): `corepack enable`)

## Tech Stack

- **Next.js 16** (App Router) + **React 19** Server Components
- **TypeScript 5.7+** end-to-end with Zod validation
- **Prisma 7** + PostgreSQL
- **Better Auth** (email/password, OAuth, 2FA, organizations, admin)
- SOON: **Stripe** billing & subscriptions
- **Tailwind CSS** + **Shadcn/ui** component library
- **TurboRepo** monorepo with pnpm
- SOON: **Sentry** error tracking + **PostHog** analytics

## Features

- **Authentication & Authorization** — Multi-provider auth, RBAC with organization roles (`owner`/`admin`/`member`), system admin, session management
- **Multi-Tenancy** — Organization-scoped data isolation, member invitations, per-org settings
- **Billing & Subscriptions** — Stripe integration with multiple tiers, usage-based billing, dunning, billing portal
- **Background Processing** — BullMQ (Redis) queue locally and on PaaS; Pub/Sub / SQS / Service Bus on Pulumi cloud profiles. At-least-once with idempotent handlers, dedicated worker process ([deploy profiles spec](docs/superpowers/specs/2026-05-28-deploy-profiles-design.md))
- **Public API** — RESTful API with key auth, rate limiting, OpenAPI docs, SDK generation
- **Webhooks** — Outbound delivery with signature verification, retry/backoff, event filtering
- **Notifications** — Email (React Email), in-app notifications, user preferences, unsubscribe
- **Monitoring** — Sentry error boundaries + performance, PostHog analytics + feature flags
- **Security** — CSRF, XSS protection, input validation, encryption, GDPR utilities

## Monorepo Structure

```
apps/
  dashboard/        — Main SaaS application
  workers/          — Background job consumer (BullMQ)
  public-api/       — REST API for integrations
  public-mcp/       — AI/MCP integrations
  www/              — Marketing site
packages/
  auth/             — Authentication & permissions
  database/         — Prisma schema, client, migrations
  ...
tooling/            — ESLint, Prettier, Tailwind, TypeScript configs
```

## Deploy

See [infra/README.md](infra/README.md) for multi-profile deployment options (local, Vercel + Supabase, Render, GCP, AWS, Azure), startup credits, and infrastructure setup guides.

## CI

GitHub Actions runs on every pull request and push to `main`:

1. `pnpm validate:env` — validates `.env.example` against typed env schemas
2. `pnpm lint` / `pnpm type-check` — static checks
3. `prisma migrate deploy` against Postgres (stock `postgres:16` locally; managed Postgres in cloud profiles). No extensions required.
4. `pnpm test` / `pnpm build`

**Local simulation:**

```bash
pnpm validate:env && pnpm lint && pnpm type-check && pnpm test && pnpm build
docker compose up -d postgres
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/app_db \
  pnpm --filter @workspace/database exec prisma migrate deploy
```

**Branch protection (recommended):** Require the `CI` / `Lint, test, build` check before merging to `main`.

**Optional parallel workflow:** `.github/workflows/e2e.yml` runs Playwright smoke tests against the dashboard when the repo variable `E2E_CI_ENABLED` is set to `true` (see [E2E tests](#end-to-end-e2e-tests) below and the [design spec](docs/superpowers/specs/2026-05-25-dashboard-playwright-e2e-design.md)).

## End-to-end (E2E) tests

Playwright smoke tests for `apps/dashboard` — eight P0 journeys (sign-in, org navigation, contacts CRUD, API key creation) running against a real Next.js production server and seeded Postgres database.

### Prerequisites

1. **Postgres running** — follow the DB setup steps in the [CI](#ci) section (`docker compose up -d postgres`).
2. **Root `.env`** — copy `.env.example` and fill in `DATABASE_URL` and auth URLs.
3. **Migrate and seed:**

   ```bash
   pnpm --filter @workspace/database exec prisma migrate deploy
   pnpm --filter @workspace/database db:seed
   ```

   Seed provides: `user@example.com` / `password123`, org `acme-inc`.

### Build and run

`next start` requires a production build first. The dashboard `start` script doesn't load env or bind port 4000, so use the `dotenv` recipe:

```bash
# 1. Build once (or after code changes)
pnpm exec dotenv -e .env -- pnpm --filter @apps/dashboard build

# 2a. Let Playwright's webServer start and manage the server automatically:
pnpm test:e2e

# 2b. Or start the server yourself in a separate terminal, then run:
pnpm exec dotenv -e .env -- pnpm --filter @apps/dashboard exec next start --port 4000
pnpm test:e2e
```

Playwright's `webServer` block auto-starts the server (loads `.env`, binds port 4000) and reuses one that's already running. Either way, a production build must exist first.

### Skip locally

```bash
E2E_DISABLED=1 pnpm test:e2e
```

Prints a skip message and exits 0 without launching a browser. Also accepts `E2E_DISABLED=true`.

### Debug

```bash
pnpm --filter @apps/dashboard test:e2e:headed   # visible browser
pnpm --filter @apps/dashboard test:e2e:ui       # Playwright UI mode
```

### Enabling E2E in CI

The E2E workflow (`.github/workflows/e2e.yml`) is **opt-in** and runs in parallel with `ci.yml`. Main CI is unchanged — no Playwright, no seed.

**Enable:** GitHub → Settings → Secrets and variables → Actions → **Variables** → add `E2E_CI_ENABLED` = `true`.

**Bypass (when enabled):** Put `[skip e2e]` in the PR title or the head commit message.

**Estimated duration:** ~8–15 min (warm cache); ~12–18 min (cold Docker build).

**Branch protection:** Do not add `e2e` to required checks until the suite is proven stable (recommend 1–2 weeks).

## Billing (Stripe)

Organization-scoped subscriptions are powered by the [`@better-auth/stripe`](https://better-auth.com/docs/plugins/stripe) plugin. Plan definitions live in the database (`BillingPlan`, seeded with `free`/`pro`/`team`); entitlements are enforced in `packages/billing`. See the [design spec](docs/superpowers/specs/2026-05-23-stripe-billing-design.md).

**Setup:**

1. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` to `.env` (see `.env.example`).
2. Replace the seeded placeholder price IDs with real Stripe **test-mode** price IDs (via the `STRIPE_PRICE_*` env vars or by editing `packages/database/prisma/seed.ts`), then run `pnpm --filter @workspace/database db:seed`.
3. Forward webhooks to the Better Auth handler while developing:

   ```bash
   stripe listen --forward-to localhost:4000/api/auth/stripe/webhook
   ```

   Use the `whsec_…` it prints as `STRIPE_WEBHOOK_SECRET`.
4. Test checkout with card `4242 4242 4242 4242` (any future expiry / CVC).

Org owners/admins manage billing under **Settings → Billing**; members get a read-only view.

## AI Assistant (@workspace/ai)

Centralized LLM infrastructure on the Vercel AI SDK. The dashboard AI Assistant streams multi-turn chat with capped MCP tool execution; workers and other backends call `generateText()` directly.

**Provider Matrix:**

| Provider | SDK Package | Required Env |
|----------|-----------|------------|
| openrouter | @openrouter/ai-sdk-provider | `OPENROUTER_API_KEY` |
| openai | @ai-sdk/openai | `OPENAI_API_KEY` |
| anthropic | @ai-sdk/anthropic | `ANTHROPIC_API_KEY` |
| ollama | @ai-sdk/openai + baseURL | none (defaults to `http://localhost:11434/v1`) |
| openai-compatible | @ai-sdk/openai + baseURL | `AI_OPENAI_COMPAT_BASE_URL` |

**Local Dev with Ollama:**

```bash
# Terminal 1: start Ollama
ollama serve

# Terminal 2: pull a model
ollama pull llama3

# Terminal 3: set .env
AI_PROVIDER=ollama
AI_MODEL=llama3

# Models run locally; no API keys required
```

**OpenRouter (Cloud):**

1. Get API key from [OpenRouter dashboard](https://openrouter.ai/keys)
2. Set `.env`:
   ```bash
   AI_PROVIDER=openrouter
   OPENROUTER_API_KEY=sk_or_xxxxxxxx
   AI_MODEL=anthropic/claude-sonnet-4
   ```
3. (Optional) Set `OPENROUTER_HTTP_REFERER` and `OPENROUTER_APP_NAME` for tracking

**Optional: Langfuse Observability**

Set both `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` to enable trace collection. The app runs without it. Use Langfuse Cloud (hobby tier free) or self-hosted OSS. Traces integrate with the Vercel AI SDK; full OTEL trace-id capture onto messages is a v1 follow-up.

**Optional: Evals (live LLM — uses API tokens)**

[promptfoo](https://promptfoo.dev) golden tests for the assistant system prompt. **Not included in `pnpm test`.** Each uncached run calls the configured provider once per test case (3 today). Identical reruns hit promptfoo’s disk cache and cost nothing.

| Command | Uses tokens? |
|---------|----------------|
| `pnpm eval:ai` | Yes, on cache miss |
| `pnpm eval:ai:live` | Yes, always (`--no-cache`) |
| `pnpm eval:ai:view` | No — browse past results locally |

Requires a provider API key in `.env`. See [`evals/promptfoo/README.md`](evals/promptfoo/README.md). For free prompt/wiring checks, use `pnpm test --filter @workspace/ai`.

## AI-Assisted Development

Includes skills, hooks, and instruction files for agentic development with Claude Code, Cursor, and other AI tools via the Superpowers framework.
