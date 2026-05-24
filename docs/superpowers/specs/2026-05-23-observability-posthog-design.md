# Observability Package — PostHog Integration Design

**Date:** 2026-05-23  
**Status:** Approved

## Overview

Extend `@workspace/observability` with PostHog product analytics after the Sentry integration has merged to `main`. One optional env var (`NEXT_PUBLIC_POSTHOG_TOKEN`) gates all behavior; host defaults via `NEXT_PUBLIC_POSTHOG_HOST`; per-app toggles live in code (`posthog-config.ts`). v1 wires **analytics only** (autocapture + pageviews) into `apps/dashboard` and `apps/www`. Dashboard identifies users on login; www stays anonymous. Feature flags and session replay are built into config but disabled — enabling them later is a config change, not an env change.

Implementation runs in an isolated worktree (`.worktrees/feat-observability-posthog`) so concurrent Sentry/other work is not disrupted.

Langfuse (LLM tracing in `@workspace/ai`) and Sentry (errors) remain separate and unchanged.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **Prerequisite** | Sentry observability work merged to `main` first |
| **Worktree** | `.worktrees/feat-observability-posthog` on branch `feat/observability-posthog` |
| **Package** | Extend `@workspace/observability` (same package as Sentry) |
| **Env vars** | `NEXT_PUBLIC_POSTHOG_TOKEN` + `NEXT_PUBLIC_POSTHOG_HOST` — unset/empty token = full no-op |
| **Config location** | `packages/observability/src/posthog-config.ts` — per-app toggles |
| **v1 PostHog products** | Analytics only (autocapture, pageviews, custom `capture()`) |
| **v1 wired apps** | `dashboard` (analytics + identify), `www` (anonymous analytics) |
| **Node apps** | `posthog-node` stub in package (`enabled: false`); no wiring in v1 |
| **User identify** | Dashboard only — sync session user to PostHog on client |
| **Wizard** | Run `npx @posthog/wizard@latest` on `apps/dashboard`, refactor output into package |
| **Init pattern** | Approach 1: centralized package + `instrumentation-client.ts` (mirrors Sentry) |
| **Reverse proxy** | Out of scope v1 (document as follow-up) |

---

## Scope

### In scope

- PostHog client init helpers, central config, and no-op-safe analytics API in `@workspace/observability`
- PostHog analytics in `apps/dashboard` and `apps/www`
- Dashboard user identification (`PostHogUserSync`)
- `.env.example` — commented `NEXT_PUBLIC_POSTHOG_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` lines
- Unit tests for config resolution and no-op behavior
- Wizard bootstrap on dashboard, then refactor into shared package

### Out of scope (v1)

- Feature flags (config exists, all `false`; no SSR flag bootstrapping)
- Session replay (config exists, all `false`)
- Reverse proxy / ad-blocker bypass (Next.js rewrites or managed proxy)
- Wiring `public-api`, `workers`, `public-mcp` server-side capture
- Organization/group analytics properties beyond user id + email
- Replacing or linking Langfuse / Sentry

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ apps/dashboard                          apps/www                        │
│  instrumentation-client.ts              instrumentation-client.ts     │
│    initClientPostHog("dashboard")         initClientPostHog("www")      │
│  features/observability/posthog-user-sync (no user sync — no auth)       │
└────────────────────────────┬────────────────────────────────────────────┘
                             │
                             ▼
              ┌──────────────────────────────┐
              │   @workspace/observability   │
              │  keys.ts          POSTHOG_*  │
              │  posthog-config.ts  per-app  │
              │  /posthog         client init + analytics API │
              │  /posthog/node    posthog-node stub (unwired) │
              └──────────────────────────────┘
                             │
                             ▼
                        PostHog Cloud
                   (analytics only in v1)
```

Other packages and app code may import `@workspace/observability/posthog` for manual `capture()` / `identify()` — safe no-ops when token is unset.

---

## Package structure

New and extended files under `packages/observability/`:

```text
packages/observability/
├── keys.ts                          # extend: POSTHOG token + host
└── src/
    ├── posthog-config.ts            # per-app toggles
    ├── posthog-config.test.ts
    ├── posthog/
    │   ├── init.ts                  # createClientInitOptions(app), initClientPostHog(app)
    │   ├── init.test.ts
    │   ├── analytics.ts             # capture, identify, reset — no-op-safe
    │   ├── analytics.test.ts
    │   └── index.ts                 # re-exports
    └── posthog-node/
        ├── init.ts                  # initNodePostHog(app) stub
        └── init.test.ts
```

### Exports

| Subpath | Purpose |
|---------|---------|
| `@workspace/observability/posthog` | Client init, `capture`, `identify`, `reset` |
| `@workspace/observability/posthog-config` | Central toggles, app registry |
| `@workspace/observability/posthog/node` | Server `posthog-node` init (built, not wired in v1) |

Existing Sentry exports are unchanged.

### Dependencies

Add to `packages/observability`:

- `posthog-js` — client analytics
- `posthog-node` — server stub for future server-side events / flags

Peer dependencies: unchanged (`next >= 15` where applicable).

---

## Environment

```bash
# .env.example — optional; unset in local dev
# NEXT_PUBLIC_POSTHOG_TOKEN=phc_...
# NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

`keys.ts` treats empty string as unset. When token is missing, the PostHog paths no-op — no SDK initialization, analytics helpers return immediately.

Default host when unset: `https://us.i.posthog.com` (US cloud). Override with `NEXT_PUBLIC_POSTHOG_HOST` for EU or self-hosted.

---

## Central config

`packages/observability/src/posthog-config.ts`:

```typescript
export type PostHogAppId =
  | "dashboard"
  | "www"
  | "public-api"
  | "workers"
  | "public-mcp";

export type PostHogAppConfig = {
  enabled: boolean;
  analytics: boolean;
  featureFlags: boolean;
  sessionReplay: boolean;
  autocapture: boolean;
  capturePageview: boolean;
  capturePageleave: boolean;
};

export const posthogApps: Record<PostHogAppId, PostHogAppConfig> = {
  dashboard: {
    enabled: true,
    analytics: true,
    featureFlags: false,
    sessionReplay: false,
    autocapture: true,
    capturePageview: true,
    capturePageleave: true,
  },
  www: {
    enabled: true,
    analytics: true,
    featureFlags: false,
    sessionReplay: false,
    autocapture: true,
    capturePageview: true,
    capturePageleave: true,
  },
  "public-api": { enabled: false, analytics: true, featureFlags: false, sessionReplay: false, autocapture: false, capturePageview: false, capturePageleave: false },
  workers:      { enabled: false, analytics: true, featureFlags: false, sessionReplay: false, autocapture: false, capturePageview: false, capturePageleave: false },
  "public-mcp": { enabled: false, analytics: true, featureFlags: false, sessionReplay: false, autocapture: false, capturePageview: false, capturePageleave: false },
};
```

**Resolution rules:**

1. No `NEXT_PUBLIC_POSTHOG_TOKEN` → disabled regardless of config
2. App `enabled: false` → disabled for that app
3. Product flags (`analytics`, `featureFlags`, `sessionReplay`) control SDK options

**Helper:**

```typescript
export function resolvePostHogConfig(appId: PostHogAppId): {
  active: boolean;
  app: PostHogAppConfig;
  token: string;
  host: string;
} | null;
```

Returns `null` when token is missing or app is disabled. All init paths call this first.

---

## Client integration

### Init options (v1 — analytics only)

When `analytics: true` and token is set, `initClientPostHog(appId)` calls `posthog.init()` with:

- `api_host` from keys
- `defaults: '2026-01-30'` (PostHog-recommended init defaults as of wizard/docs)
- `autocapture` per config
- `capture_pageview` / `capture_pageleave` per config
- `advanced_disable_feature_flags: true` when `featureFlags: false` (avoids flag API calls in v1)
- Session replay disabled when `sessionReplay: false`
- `loaded` callback sets super property `app: "<app-id>"` for event segmentation
- `person_profiles: 'identified_only'` — only create person profiles after `identify()` (reduces anonymous noise on www)

Init wrapped in try/catch; failures log to stderr and do not crash the app.

### App wiring (dashboard & www)

Each app adds thin files delegating to the package:

| File | Content |
|------|---------|
| `instrumentation-client.ts` | Import existing Sentry init if present; add `initClientPostHog("<app>")` |
| `next.config.ts` | Ensure `@workspace/observability` in `transpilePackages` (likely already from Sentry) |

No separate `posthog.client.config.ts` — PostHog uses Next.js `instrumentation-client.ts` per official docs.

Add `posthog-js` as a dependency of `@workspace/observability` only; apps do not declare it directly.

### Dashboard user identification

`apps/dashboard/features/observability/ui/posthog-user-sync.tsx`:

- Client component mounted alongside `SentryUserSync` in auth provider
- Reads session via existing auth client hook
- Keys effect on primitive `userId` / `userEmail` (same pattern as Sentry — avoid refetch churn)
- Calls `identify(userId, { email })` when signed in
- Calls `reset()` on sign-out / no session
- Does not send organization or role data in v1

`www` has no user sync — anonymous autocapture only until a visitor signs up and lands in dashboard (PostHog can merge funnels across apps in one project when identify happens later).

---

## Analytics API

`@workspace/observability/posthog` exports no-op-safe wrappers:

```typescript
capture(event: string, properties?: Record<string, unknown>): void
identify(userId: string, properties?: { email?: string }): void
reset(): void
```

When PostHog is not active (no token or app disabled), all three are no-ops and never throw. Internally they delegate to the `posthog-js` singleton only when initialized.

---

## Node integration (built, not wired)

`initNodePostHog(appId)` wraps `posthog-node` with the same config resolution. Intended for future server-side events and SSR feature flags:

- `apps/public-api` — call at server startup
- `apps/workers` — call at worker startup
- `apps/public-mcp` — call at server startup

Not called in v1 because all node apps have `enabled: false`. When wired later, use `flushAt: 1`, `flushInterval: 0`, and `await posthog.shutdown()` after short-lived server captures (PostHog Next.js guidance).

---

## Wizard workflow

1. Create worktree from `main` (after Sentry merge): `.worktrees/feat-observability-posthog`
2. Run `npx @posthog/wizard@latest --integration nextjs --install-dir apps/dashboard` (interactive or `--ci` with API key if available)
3. Capture wizard output: SDK version, init options, env var names, any reverse-proxy rewrites
4. **Discard** app-local duplication — move init logic into `@workspace/observability/posthog`
5. Replace dashboard wizard files with thin `instrumentation-client.ts` one-liner
6. Wire `www` manually using the same package helpers (no second wizard run required)
7. Remove any wizard-generated files that duplicate package concerns (e.g. standalone `posthog.js` client factory in app root)

---

## Relationship to other observability

| Concern | Owner | Env |
|---------|-------|-----|
| App errors & crashes | `@workspace/observability` / Sentry | `SENTRY_DSN` |
| Product analytics | `@workspace/observability` / PostHog | `NEXT_PUBLIC_POSTHOG_*` |
| LLM trace observability | `@workspace/ai` / Langfuse | `LANGFUSE_*` |

No cross-linking in v1. Future follow-ups: attach Sentry error context to PostHog session; link Langfuse trace IDs to PostHog person properties.

---

## Error handling

- PostHog init failures must not crash the app — try/catch, log to stderr, continue
- `capture` / `identify` / `reset` must never throw — swallow internal SDK errors
- Missing env in CI/local dev is normal — full no-op, no warnings beyond optional debug

---

## Follow-ups (document only)

- Enable feature flags per app via config + `@posthog/react` hooks
- Enable session replay per app via config
- Next.js reverse proxy rewrites for ad-blocker resilience
- Wire node apps for server-side capture
- Organization/group analytics (`posthog.group()`)
- PostHog ↔ Sentry / Langfuse correlation

---

## Critical Tests

- `packages/observability/src/posthog-config.test.ts`: `resolvePostHogConfig("dashboard")` returns enabled when token present and app enabled; returns `null` when token missing; returns `null` when app `enabled: false`.
- `packages/observability/src/posthog/init.test.ts`: `createClientInitOptions("dashboard")` with analytics-only config sets `advanced_disable_feature_flags: true` and omits replay; disabled app returns `null`; `initClientPostHog` no-ops when token unset.
- `packages/observability/src/posthog/analytics.test.ts`: `capture` / `identify` / `reset` are no-ops when token unset — no throw, no SDK call.
- `packages/observability/src/posthog-node/init.test.ts`: `initNodePostHog("public-api")` no-ops when app disabled in config.

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm --filter @workspace/observability test`
- Manual: set `NEXT_PUBLIC_POSTHOG_TOKEN` in `.env`, run dashboard dev, confirm autocapture events in PostHog with `app:dashboard` super property; sign in and confirm person profile created with user id
