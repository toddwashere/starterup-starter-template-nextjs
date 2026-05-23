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

## AI-Assisted Development

Includes skills, hooks, and instruction files for agentic development with Claude Code, Cursor, and other AI tools via the Superpowers framework.
