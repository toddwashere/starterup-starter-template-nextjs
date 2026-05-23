# superpowers-starter-template-nextjs

A production-ready SaaS starter template built with [Superpowers](https://github.com/obra/superpowers) for agentic AI development.

## Tech Stack

- **Next.js 16** (App Router) + **React 19** Server Components
- **TypeScript 5.7+** end-to-end with Zod validation
- **Prisma 7** + PostgreSQL with pgmq & pg_cron
- **Better Auth** (email/password, OAuth, 2FA, organizations, admin)
- **Stripe** billing & subscriptions
- **Tailwind CSS** + **Shadcn/ui** component library
- **TurboRepo** monorepo with pnpm
- **Sentry** error tracking + **PostHog** analytics

## Features

- **Authentication & Authorization** — Multi-provider auth, RBAC with organization roles (`owner`/`admin`/`member`), system admin, session management
- **Multi-Tenancy** — Organization-scoped data isolation, member invitations, per-org settings
- **Billing & Subscriptions** — Stripe integration with multiple tiers, usage-based billing, dunning, billing portal
- **Background Processing** — pgmq durable queue (at-least-once, idempotent handlers), pg_cron scheduled jobs, dedicated worker process ([design spec](docs/superpowers/specs/2026-05-22-worker-queue-pgmq-design.md))
- **Public API** — RESTful API with key auth, rate limiting, OpenAPI docs, SDK generation
- **Webhooks** — Outbound delivery with signature verification, retry/backoff, event filtering
- **Notifications** — Email (React Email), in-app notifications, user preferences, unsubscribe
- **Monitoring** — Sentry error boundaries + performance, PostHog analytics + feature flags
- **Security** — CSRF, XSS protection, input validation, encryption, GDPR utilities

## Monorepo Structure

```
apps/
  dashboard/        — Main SaaS application
  workers/          — Background job consumer (pgmq)
  public-api/       — REST API for integrations
  public-mcp/       — AI/MCP integrations
  www/              — Marketing site
packages/
  auth/             — Authentication & permissions
  database/         — Prisma schema, client, migrations
  ...
tooling/            — ESLint, Prettier, Tailwind, TypeScript configs
```

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

**Optional: Evals**

Run `pnpm eval:ai` to evaluate the assistant system prompt with [promptfoo](https://promptfoo.dev). Requires a provider API key and generated test cases.

## AI-Assisted Development

Includes skills, hooks, and instruction files for agentic development with Claude Code, Cursor, and other AI tools via the Superpowers framework.
