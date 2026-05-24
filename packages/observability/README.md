# @workspace/observability

Centralizes Sentry error monitoring for all apps in this monorepo. A single
optional env var, `SENTRY_DSN`, gates everything — when unset the entire
package no-ops (no SDK init, all capture helpers return immediately). V1 is
**errors only**; tracing, session replay, and log ingestion are pre-configured
but not yet wired.

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

---

## Configuration

All per-app settings live in `src/sentry-config.ts`.

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

## V1 scope: errors only

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

## Wiring a Next.js app

`dashboard` and `www` are already wired. Follow these steps for a new app:

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

## Wiring a Node (non-Next) app

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

## Relationship to Langfuse

Sentry (app errors) and Langfuse (LLM tracing, via `@workspace/ai` and
`LANGFUSE_*` env vars) are entirely separate and independent in v1. There is
no shared context between them.

---

## Follow-ups

- **Enable tracing / logs / replay per app** — requires both config flag + init
  integration change (see [V1 scope: errors only](#v1-scope-errors-only)).
- **Wire node apps** — `initNodeObservability` is ready; set `enabled: true` in
  `sentryApps`.
- **Source map upload in CI** — requires `SENTRY_AUTH_TOKEN` (a separate build-time
  token, distinct from the runtime `SENTRY_DSN`). Configure in CI and pass to
  `withSentryConfig`.
- **PostHog integration** — not yet implemented.
- **Link Langfuse trace IDs to Sentry error context** — not yet implemented.
