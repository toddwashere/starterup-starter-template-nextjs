# Observability Package — Sentry Integration Design

**Date:** 2026-05-23  
**Status:** Approved

## Overview

Add `@workspace/observability` as the monorepo's centralized Sentry integration. One optional env var (`SENTRY_DSN`) gates all behavior; every product toggle, sample rate, and per-app setting lives in code (`sentry-config.ts`). v1 wires **error capture only** into `apps/dashboard` and `apps/www`. Tracing, logs, and session replay are built into the package but disabled in config — enabling them later is a config change, not an env change.

Langfuse (LLM tracing in `@workspace/ai`) remains separate and unchanged.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **Package name** | `@workspace/observability` (supersedes `packages/monitoring` from auth plan) |
| **Env vars** | `SENTRY_DSN` only — unset = full no-op |
| **Config location** | `packages/observability/src/sentry-config.ts` — per-app toggles and sample rates |
| **v1 Sentry products** | Errors only |
| **v1 wired apps** | `dashboard`, `www` |
| **Node apps** | Config stubs (`enabled: false`); no wiring in v1 |
| **User context** | Dashboard only — sync session user to Sentry on client |
| **PostHog** | Out of scope (mentioned in auth plan; separate follow-up) |

---

## Scope

### In scope

- New `packages/observability` with keys, central config, Next.js helpers, Node helpers (unwired), and no-op-safe capture API
- Sentry error capture in `apps/dashboard` and `apps/www`
- `.env.example` — one commented `SENTRY_DSN` line
- Unit tests for config resolution and no-op behavior

### Out of scope (v1)

- Enabling tracing, logs, or session replay (config exists, all `false`)
- Wiring `public-api`, `workers`, `public-mcp`, `email-preview`
- PostHog / product analytics
- Sentry source map upload in CI (document as follow-up)
- Per-app Sentry projects / multiple DSNs
- Replacing Langfuse

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ apps/dashboard                          apps/www                        │
│  instrumentation.ts                     instrumentation.ts            │
│  sentry.{client,server,edge}.config.ts  sentry.{client,server,edge}.…  │
│  app/global-error.tsx                   app/global-error.tsx            │
│  next.config.ts → withSentryConfig        next.config.ts → …             │
│  features/observability/sentry-user-sync  (no user sync — no auth)       │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │   @workspace/observability   │
              │  keys.ts          SENTRY_DSN │
              │  sentry-config.ts  per-app   │
              │  /next            @sentry/nextjs wrappers │
              │  /node            @sentry/node wrappers (stub) │
              │  /capture         no-op-safe helpers       │
              └──────────────────────────────┘
                             │
                             ▼
                        Sentry.io
                   (errors only in v1)
```

Other packages may import `@workspace/observability/capture` for manual `captureException` calls — safe no-ops when DSN is unset.

---

## Package structure

```text
packages/observability/
├── package.json
├── tsconfig.json
├── eslint.config.mjs
├── vitest.config.ts
├── keys.ts
└── src/
    ├── sentry-config.ts
    ├── sentry-config.test.ts
    ├── capture.ts
    ├── capture.test.ts
    ├── next/
    │   ├── init.ts              # createInitOptions(app), registerObservability
    │   ├── init.test.ts
    │   ├── with-sentry-config.ts
    │   └── global-error.tsx     # reusable GlobalError component
    └── node/
        ├── init.ts              # initNodeObservability(app)
        └── init.test.ts
```

### Exports

| Subpath | Purpose |
|---------|---------|
| `@workspace/observability/keys` | Parse optional `SENTRY_DSN` |
| `@workspace/observability/sentry-config` | Central toggles, sample rates, app registry |
| `@workspace/observability/next` | Next.js init, `withSentryConfig`, `GlobalError` |
| `@workspace/observability/node` | Node/Hono/worker init (built, not wired in v1) |
| `@workspace/observability/capture` | `captureException`, `setUser`, `addBreadcrumb` |

### Dependencies

- `@sentry/nextjs` — used by `/next` export
- `@sentry/node` — used by `/node` export and `/capture` server-side
- `zod` — env parsing (matches `@workspace/email`, `@workspace/ai` pattern)

Peer dependencies: `next >= 15` on `/next` export only.

---

## Environment

```bash
# .env.example — optional; unset in local dev
# SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
```

`keys.ts` treats empty string as unset. When DSN is missing, the entire package no-ops — no Sentry SDK initialization, capture helpers return immediately.

---

## Central config

`packages/observability/src/sentry-config.ts`:

```typescript
export type SentryAppId =
  | "dashboard"
  | "www"
  | "public-api"
  | "workers"
  | "public-mcp";

export type SentryAppConfig = {
  enabled: boolean;
  errors: boolean;
  tracing: boolean;
  tracesSampleRate: number;
  logs: boolean;
  replay: boolean;
  replaysSessionSampleRate: number;
  replaysOnErrorSampleRate: number;
};

export const sentryApps: Record<SentryAppId, SentryAppConfig> = {
  dashboard: {
    enabled: true,
    errors: true,
    tracing: false,
    tracesSampleRate: 0.1,
    logs: false,
    replay: false,
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
  },
  www: {
    enabled: true,
    errors: true,
    tracing: false,
    tracesSampleRate: 0.1,
    logs: false,
    replay: false,
    replaysSessionSampleRate: 0.05,
    replaysOnErrorSampleRate: 1.0,
  },
  "public-api": {
    enabled: false,
    errors: true,
    tracing: false,
    tracesSampleRate: 0.1,
    logs: false,
    replay: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  },
  workers: {
    enabled: false,
    errors: true,
    tracing: false,
    tracesSampleRate: 0.1,
    logs: false,
    replay: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  },
  "public-mcp": {
    enabled: false,
    errors: true,
    tracing: false,
    tracesSampleRate: 0.1,
    logs: false,
    replay: false,
    replaysSessionSampleRate: 0,
    replaysOnErrorSampleRate: 0,
  },
};
```

**Resolution rules:**

1. No `SENTRY_DSN` → disabled regardless of config
2. App `enabled: false` → disabled for that app
3. Product flags (`errors`, `tracing`, etc.) control which Sentry integrations are registered

Sample rates are pre-set for when tracing/replay are enabled later — they have no effect while the product flag is `false`.

**Helper:**

```typescript
export function resolveSentryConfig(appId: SentryAppId): {
  active: boolean;
  app: SentryAppConfig;
} | null;
```

Returns `null` when DSN is missing or app is disabled. All init paths call this first.

---

## Next.js integration

### App wiring (dashboard & www)

Each app adds thin files that delegate to the package:

| File | Content |
|------|---------|
| `instrumentation.ts` | `export async function register() { await registerObservability("<app>"); }` |
| `sentry.client.config.ts` | `import { initClientSentry } from "@workspace/observability/next"; initClientSentry("dashboard");` |
| `sentry.server.config.ts` | `import { initServerSentry } from "@workspace/observability/next"; initServerSentry("dashboard");` |
| `sentry.edge.config.ts` | `import { initEdgeSentry } from "@workspace/observability/next"; initEdgeSentry("dashboard");` |
| `app/global-error.tsx` | `export { createGlobalError("dashboard") as default } from "@workspace/observability/next"` |
| `next.config.ts` | Wrap existing config: `export default withSentryConfig(existingConfig, "dashboard")` |

Add `@workspace/observability` to app dependencies. Add package to `transpilePackages` in `next.config.ts`.

### v1 SDK options (errors only)

When `errors: true` and DSN is set:

- Initialize Sentry with DSN, `environment: process.env.NODE_ENV`, `release` from `process.env.VERCEL_GIT_COMMIT_SHA` or package version when available
- Set initial tag `app: "<app-id>"`
- **Do not** register `browserTracingIntegration`, `replayIntegration`, or enable logs
- `tracesSampleRate` omitted (tracing off)
- `beforeSend` filters known dev noise: Next.js hydration mismatch warnings, `AbortError`, cancelled fetch

### Dashboard user context

`apps/dashboard/features/observability/ui/sentry-user-sync.tsx`:

- Client component mounted inside `Providers` in auth-provider
- Reads session via existing auth client hook
- Calls `setUser({ id: user.id, email: user.email })` when signed in
- Calls `setUser(null)` on sign-out / no session
- Does not send organization or role data in v1

---

## Node integration (built, not wired)

`initNodeObservability(appId)` wraps `@sentry/node` with the same config resolution. Intended for:

- `apps/public-api` — call at top of `src/index.ts`
- `apps/workers` — call at worker startup
- `apps/public-mcp` — call at server startup

Not called in v1 because all node apps have `enabled: false`.

---

## Capture API

`@workspace/observability/capture` exports thin wrappers:

```typescript
captureException(error: unknown, context?: Record<string, unknown>): void
setUser(user: { id: string; email?: string } | null): void
addBreadcrumb(breadcrumb: { message: string; category?: string; data?: Record<string, unknown> }): void
```

When Sentry is not active (no DSN or app disabled), all three are no-ops. This lets domain packages report errors without checking whether Sentry is configured.

---

## Relationship to Langfuse

| Concern | Owner | Env |
|---------|-------|-----|
| App errors & crashes | `@workspace/observability` / Sentry | `SENTRY_DSN` |
| LLM trace observability | `@workspace/ai` / Langfuse | `LANGFUSE_*` |

No integration between them in v1. Future follow-up: attach `langfuseTraceId` from AI message metadata as a Sentry tag when capturing AI-related errors.

---

## Error handling

- Sentry init failures must not crash the app — wrap in try/catch, log to stderr, continue
- `captureException` must never throw — swallow internal Sentry errors
- `global-error.tsx` reports to Sentry then renders a minimal fallback UI (Sentry's recommended pattern)

---

## Follow-ups (document only)

- Enable tracing/logs/replay per app via config toggles
- Wire node apps (`public-api`, `workers`, `public-mcp`)
- Sentry source map upload in CI (`SENTRY_AUTH_TOKEN` — separate from runtime DSN)
- PostHog integration in same package or sibling
- Link Langfuse trace IDs to Sentry error context

## Critical Tests

- `packages/observability/src/sentry-config.test.ts`: `resolveSentryConfig("dashboard")` returns enabled when DSN present and app enabled; returns disabled when DSN missing; returns disabled when app `enabled: false`.
- `packages/observability/src/next/init.test.ts`: `createInitOptions("dashboard")` with errors-only config omits tracing/replay integrations; `createInitOptions("www")` sets `app` tag; disabled app returns `null` (no init).
- `packages/observability/src/capture.test.ts`: `captureException` / `setUser` / `addBreadcrumb` are no-ops when DSN unset — no throw, no Sentry SDK call.
- `packages/observability/src/node/init.test.ts`: `initNodeObservability("public-api")` no-ops when app disabled in config.

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm --filter @workspace/observability test`
- Manual: set `SENTRY_DSN` in `.env`, trigger a test error in dashboard dev, confirm event appears in Sentry with `app:dashboard` tag
