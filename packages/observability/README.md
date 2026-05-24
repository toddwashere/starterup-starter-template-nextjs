# @workspace/observability

Centralizes **Sentry** error monitoring and **PostHog** product analytics for all
apps in this monorepo. Each integration is gated by its own optional env vars —
when unset the entire integration no-ops (no SDK init, all helpers return
immediately).

- **Sentry v1:** errors only; tracing, session replay, and log ingestion are
  pre-configured but not yet wired.
- **PostHog v1:** analytics only (autocapture + pageviews + custom `capture()`);
  feature flags and session replay are pre-configured but disabled.

---

## Exports

| Subpath                                      | Purpose                                                                                                                                                                                                     |
| -------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@workspace/observability/keys`              | `keys()` / `clientDsn()` — validated env access (Zod). Used internally; rarely needed directly.                                                                                                             |
| `@workspace/observability/sentry-config`     | `sentryApps` registry + `resolveSentryConfig(appId)` — per-app toggles and sample rates.                                                                                                                    |
| `@workspace/observability/capture`           | `captureException`, `setUser`, `addBreadcrumb` — isomorphic helpers, safe no-ops when DSN is unset.                                                                                                         |
| `@workspace/observability/next`              | `initClientSentry`, `initServerSentry`, `initEdgeSentry`, `withSentryConfig` — Next.js wiring. **No JSX.**                                                                                                  |
| `@workspace/observability/next/global-error` | `createGlobalError(appId)` — returns a React component for `app/global-error.tsx`. Separate entry to keep `./next` free of JSX so it can be safely imported from `next.config.ts` (CJS evaluation context). |
| `@workspace/observability/node`              | `initNodeObservability(appId)` — Node.js (non-Next) init via `@sentry/node`.                                                                                                                                |
| `@workspace/observability/posthog-config`    | `posthogApps` registry + `resolvePostHogConfig(appId)` — per-app PostHog toggles.                                                                                                                           |
| `@workspace/observability/posthog`           | `initClientPostHog`, `capture`, `identify`, `reset` — browser init + no-op-safe analytics helpers.                                                                                                           |
| `@workspace/observability/posthog/node`      | `initNodePostHog(appId)` — Node.js (non-Next) init via `posthog-node`. Built, unwired in v1.                                                                                                               |

---

## Sentry configuration

All per-app Sentry settings live in `src/sentry-config.ts`.

```ts
// src/sentry-config.ts
export const sentryApps: Record<SentryAppId, SentryAppConfig> = {
  dashboard: { enabled: true, errors: true, tracing: false, ... },
  www:       { enabled: true, errors: true, tracing: false, ... },
  "public-api": { enabled: false, ... },
  workers:      { enabled: false, ... },
  "public-mcp": { enabled: false, ... },
};
```

`SentryAppId` is the union of those keys: `"dashboard" | "www" | "public-api" | "workers" | "public-mcp"`.

`resolveSentryConfig(appId)` returns `null` when:

- `SENTRY_DSN` is unset, **or**
- the app's `enabled` flag is `false`.

When it returns `null` every init function exits early — nothing is registered.

---

## PostHog configuration

All per-app PostHog settings live in `src/posthog-config.ts`.

```ts
// src/posthog-config.ts
export const posthogApps: Record<PostHogAppId, PostHogAppConfig> = {
  dashboard: { enabled: true, analytics: true, featureFlags: false, sessionReplay: false, ... },
  www:       { enabled: true, analytics: true, featureFlags: false, sessionReplay: false, ... },
  "public-api": { enabled: false, ... },
  workers:      { enabled: false, ... },
  "public-mcp": { enabled: false, ... },
};
```

`PostHogAppId` uses the same app id union as Sentry.

Env vars (see `.env.example`):

- `NEXT_PUBLIC_POSTHOG_TOKEN` — project API key; when unset/empty the whole PostHog integration no-ops.
- `NEXT_PUBLIC_POSTHOG_HOST` — optional; defaults to `https://us.i.posthog.com`.

`resolvePostHogConfig(appId)` returns `null` when:

- `NEXT_PUBLIC_POSTHOG_TOKEN` is unset, **or**
- the app's `enabled` flag is `false`.

---

## PostHog v1 scope: analytics only

v1 wires **autocapture**, **pageviews**, and the manual `capture()` / `identify()` /
`reset()` helpers. `featureFlags` and `sessionReplay` are `false` for all apps;
`initClientPostHog` sets `advanced_disable_feature_flags: true` and
`disable_session_recording: true` accordingly.

Enabling feature flags or session replay later requires **two steps**:

1. Set `featureFlags: true` and/or `sessionReplay: true` in `posthogApps` inside
   `posthog-config.ts`.
2. Update `buildInitOptions` in `src/posthog/init.ts` if additional SDK options
   are needed (e.g. remove `advanced_disable_feature_flags` when enabling flags).

---

## Sentry v1 scope: errors only

`src/next/init.ts` and `src/node/init.ts` both hardcode `integrations: []` and
omit `tracesSampleRate`. The `tracing`, `logs`, and `replay` flags in
`sentryApps` are pre-set to `false` with sample rates ready, **but they have no
effect in v1** — flipping a flag alone is not sufficient.

Enabling a product requires **two steps**:

1. Set the relevant flag (`tracing: true`, `replay: true`, etc.) in
   `sentryApps` inside `sentry-config.ts`.
2. Register the corresponding Sentry integration and pass the sample rate in
   the init builder (`src/next/init.ts` or `src/node/init.ts`). For example,
   enabling tracing on Next.js means adding the `browserTracingIntegration` /
   `httpIntegration` to the `integrations` array and setting `tracesSampleRate`.

---

## Wiring a Next.js app (Sentry)

`dashboard` and `www` are already wired for Sentry. Follow these steps for a new app:

### 1. Dependencies

Add to the app's `package.json`:

```json
"@workspace/observability": "workspace:*",
"@sentry/nextjs": "^10"
```

The app must list `@sentry/nextjs` directly because `instrumentation.ts` and
the sentry config files import it by name.

### 2. `next.config.ts`

```ts
import { withSentryConfig } from "@workspace/observability/next";

const nextConfig: NextConfig = {
  transpilePackages: ["@workspace/observability", ...],
  ...
};

export default withSentryConfig(nextConfig, "my-app");
```

### 3. `instrumentation.ts` (server + edge init)

```ts
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = Sentry.captureRequestError;
```

`onRequestError` is wired straight from `@sentry/nextjs` (no wrapper is
provided for this Next.js hook), which is why the app declares the SDK directly.

### 4. `instrumentation-client.ts` (browser init)

```ts
import { initClientSentry } from "@workspace/observability/next";

initClientSentry("my-app");
```

### 5. `sentry.server.config.ts` and `sentry.edge.config.ts`

```ts
// sentry.server.config.ts
import { initServerSentry } from "@workspace/observability/next";
initServerSentry("my-app");

// sentry.edge.config.ts
import { initEdgeSentry } from "@workspace/observability/next";
initEdgeSentry("my-app");
```

### 6. `app/global-error.tsx`

```tsx
"use client";
import { createGlobalError } from "@workspace/observability/next/global-error";

export default createGlobalError("my-app");
```

### 7. `turbo.json` globalEnv

`SENTRY_DSN`, `NEXT_PUBLIC_SENTRY_DSN`, and `VERCEL_GIT_COMMIT_SHA` are
already declared in `turbo.json` `globalEnv` — no extra changes needed.

---

## Wiring a Next.js app (PostHog)

`dashboard` and `www` are already wired for PostHog. Add to
`instrumentation-client.ts` alongside Sentry init:

```ts
import { initClientPostHog } from "@workspace/observability/posthog";

initClientPostHog("my-app");
```

No extra app dependency is needed — `posthog-js` lives in `@workspace/observability`.

For authenticated apps, mount a user-sync component that calls `identify()` on
login and `reset()` on logout (see `apps/dashboard/features/observability/ui/posthog-user-sync.tsx`).
Anonymous apps (e.g. `www`) skip user sync.

Declare `NEXT_PUBLIC_POSTHOG_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` in
`turbo.json` `globalEnv` if not already present.

---

## Wiring a Node (non-Next) app (Sentry)

Call `initNodeObservability` at process startup and enable the app in
`sentry-config.ts`:

```ts
// apps/workers/src/index.ts
import { initNodeObservability } from "@workspace/observability/node";

initNodeObservability("workers");
```

Also set `enabled: true` for `"workers"` in `sentryApps`. Built and type-safe
in v1 but not yet wired.

---

## Wiring a Node (non-Next) app (PostHog)

Call `initNodePostHog` at process startup and enable the app in
`posthog-config.ts`:

```ts
// apps/workers/src/index.ts
import { initNodePostHog } from "@workspace/observability/posthog/node";

initNodePostHog("workers");
```

Also set `enabled: true` for `"workers"` in `posthogApps`. Built and type-safe
in v1 but not yet wired.

---

## Manual capture

Any package or app can import `@workspace/observability/capture`:

```ts
import { captureException, setUser, addBreadcrumb } from "@workspace/observability/capture";

// All three are no-ops when SENTRY_DSN is unset — safe to call unconditionally.
captureException(err, { requestId });
setUser({ id: user.id, email: user.email });
addBreadcrumb({ message: "payment initiated", category: "billing" });
```

Uses the isomorphic `@sentry/nextjs` SDK so it's safe in both server and client
code.

---

## PostHog manual capture

Import `@workspace/observability/posthog` in client code:

```ts
import { capture, identify, reset } from "@workspace/observability/posthog";

// All three are no-ops when NEXT_PUBLIC_POSTHOG_TOKEN is unset — safe to call unconditionally.
capture("button_clicked", { plan: "pro" });
identify(user.id, { email: user.email });
reset();
```

---

## Relationship to Langfuse

Sentry (app errors), PostHog (product analytics), and Langfuse (LLM tracing,
via `@workspace/ai` and `LANGFUSE_*` env vars) are entirely separate and
independent in v1. There is no shared context between them.

---

## Follow-ups

- **Enable Sentry tracing / logs / replay per app** — requires both config flag + init
  integration change (see [Sentry v1 scope: errors only](#sentry-v1-scope-errors-only)).
- **Enable PostHog feature flags / session replay** — flip flags in
  `posthog-config.ts` and update `src/posthog/init.ts` as needed.
- **Wire node apps** — `initNodeObservability` and `initNodePostHog` are ready;
  set `enabled: true` in the respective config registries.
- **PostHog reverse proxy** — ad-blocker bypass via Next.js rewrites (out of v1 scope).
- **Source map upload in CI** — requires `SENTRY_AUTH_TOKEN` (a separate build-time
  token, distinct from the runtime `SENTRY_DSN`). Configure in CI and pass to
  `withSentryConfig`.
- **Link Langfuse trace IDs to Sentry error context** — not yet implemented.
