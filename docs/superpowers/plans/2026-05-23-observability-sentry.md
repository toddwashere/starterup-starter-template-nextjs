# Observability Package — Sentry Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `@workspace/observability` with centralized Sentry config (one env var: `SENTRY_DSN`), error capture wired into `apps/dashboard` and `apps/www`, and no-op-safe capture helpers for the rest of the monorepo.

**Architecture:** All product toggles and sample rates live in `packages/observability/src/sentry-config.ts`. Apps add thin wiring files that delegate to `@workspace/observability/next`. When `SENTRY_DSN` is unset, nothing initializes and capture helpers no-op. Node init is built but not wired (apps stubbed `enabled: false`).

**Tech Stack:** `@sentry/nextjs`, `@sentry/node`, Next.js 16 App Router, Zod, Vitest.

**Design spec:** [`docs/superpowers/specs/2026-05-23-observability-sentry-design.md`](../specs/2026-05-23-observability-sentry-design.md)

**Note:** Sentry's current Next.js 15+ manual setup uses `instrumentation-client.ts` (not `sentry.client.config.ts`). This plan follows current Sentry docs.

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/observability/package.json` | Package manifest + subpath exports |
| `packages/observability/keys.ts` | Parse optional `SENTRY_DSN` |
| `packages/observability/src/sentry-config.ts` | Per-app toggles + `resolveSentryConfig()` |
| `packages/observability/src/capture.ts` | No-op-safe `captureException`, `setUser`, `addBreadcrumb` |
| `packages/observability/src/next/init.ts` | `createInitOptions`, `initClientSentry`, `initServerSentry`, `initEdgeSentry` |
| `packages/observability/src/next/with-sentry-config.ts` | Wrap `next.config` + expose DSN to client bundle |
| `packages/observability/src/next/global-error.tsx` | `createGlobalError(appId)` factory |
| `packages/observability/src/node/init.ts` | `initNodeObservability(appId)` — built, unwired |
| `apps/dashboard/instrumentation.ts` | Server/edge Sentry registration |
| `apps/dashboard/instrumentation-client.ts` | Client Sentry init |
| `apps/dashboard/sentry.server.config.ts` | Server init delegate |
| `apps/dashboard/sentry.edge.config.ts` | Edge init delegate |
| `apps/dashboard/app/global-error.tsx` | Root error boundary |
| `apps/dashboard/next.config.ts` | Wrap with `withSentryConfig` |
| `apps/dashboard/features/observability/ui/sentry-user-sync.tsx` | Sync session user to Sentry |
| `apps/dashboard/features/auth/ui/auth-provider.tsx` | Mount `SentryUserSync` |
| `apps/www/...` | Same Sentry wiring as dashboard (no user sync) |
| `.env.example` | Commented `SENTRY_DSN` line |

---

## Critical Tests

- `packages/observability/src/sentry-config.test.ts`: `resolveSentryConfig("dashboard")` active when DSN + app enabled; `null` when DSN missing or app disabled.
- `packages/observability/src/next/init.test.ts`: `createInitOptions("dashboard")` errors-only — no tracing/replay integrations; sets `app` tag; disabled app returns `null`.
- `packages/observability/src/capture.test.ts`: `captureException` / `setUser` / `addBreadcrumb` no-op when DSN unset — no throw.
- `packages/observability/src/node/init.test.ts`: `initNodeObservability("public-api")` no-ops when app disabled.

---

### Task 1: Scaffold `@workspace/observability`

**Files:**
- Create: `packages/observability/package.json`
- Create: `packages/observability/tsconfig.json`
- Create: `packages/observability/eslint.config.mjs`
- Create: `packages/observability/vitest.config.ts`

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "@workspace/observability",
  "version": "0.0.0",
  "private": true,
  "type": "module",
  "exports": {
    "./keys": "./keys.ts",
    "./sentry-config": "./src/sentry-config.ts",
    "./capture": "./src/capture.ts",
    "./next": "./src/next/index.ts",
    "./node": "./src/node/init.ts"
  },
  "scripts": {
    "type-check": "tsc --noEmit",
    "lint": "eslint .",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@sentry/nextjs": "^10.0.0",
    "@sentry/node": "^10.0.0",
    "zod": "^3"
  },
  "peerDependencies": {
    "next": ">=15",
    "react": ">=19"
  },
  "devDependencies": {
    "@types/node": "^22",
    "@types/react": "^19",
    "@workspace/tooling": "workspace:*",
    "next": "^16",
    "react": "^19",
    "typescript": "^5.7",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Create `tsconfig.json`**

```json
{
  "extends": "@workspace/tooling/typescript/base.json",
  "compilerOptions": {
    "outDir": "dist",
    "lib": ["ES2022", "DOM"],
    "types": ["node"],
    "jsx": "react-jsx"
  },
  "include": ["src", "keys.ts"]
}
```

- [ ] **Step 3: Create `eslint.config.mjs`**

```javascript
import reactConfig from "@workspace/tooling/eslint/react";

export default [...reactConfig];
```

- [ ] **Step 4: Create `vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
  },
});
```

- [ ] **Step 5: Install dependencies**

Run: `pnpm install`

Expected: lockfile updated, no install errors.

- [ ] **Step 6: Commit**

```bash
git add packages/observability/package.json packages/observability/tsconfig.json packages/observability/eslint.config.mjs packages/observability/vitest.config.ts pnpm-lock.yaml
git commit -m "chore(observability): scaffold @workspace/observability package"
```

---

### Task 2: `keys.ts` + `sentry-config.ts` (TDD)

**Files:**
- Create: `packages/observability/keys.ts`
- Create: `packages/observability/src/sentry-config.ts`
- Create: `packages/observability/src/sentry-config.test.ts`

- [ ] **Step 1: Write failing tests for `resolveSentryConfig`**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSentryConfig } from "./sentry-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveSentryConfig()", () => {
  it("returns active config for dashboard when DSN is set", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");

    const result = resolveSentryConfig("dashboard");

    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.app.errors).toBe(true);
  });

  it("returns null when SENTRY_DSN is missing", () => {
    vi.stubEnv("SENTRY_DSN", "");

    expect(resolveSentryConfig("dashboard")).toBeNull();
  });

  it("returns null when app is disabled in config", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");

    expect(resolveSentryConfig("public-api")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @workspace/observability test`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `keys.ts`**

```typescript
import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const schema = z.object({
  SENTRY_DSN: optionalString,
});

export function keys() {
  return schema.parse({
    SENTRY_DSN: process.env.SENTRY_DSN,
  });
}

/** Client bundles read DSN injected by withSentryConfig (see next/with-sentry-config.ts). */
export function clientDsn(): string | undefined {
  const fromPublic = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (fromPublic && fromPublic.length > 0) return fromPublic;
  return keys().SENTRY_DSN;
}
```

- [ ] **Step 4: Implement `sentry-config.ts`**

Copy the full `SentryAppId`, `SentryAppConfig`, and `sentryApps` object from the design spec. Add:

```typescript
import { keys } from "../keys";

export function resolveSentryConfig(appId: SentryAppId): {
  active: boolean;
  app: SentryAppConfig;
  dsn: string;
} | null {
  const { SENTRY_DSN } = keys();
  if (!SENTRY_DSN) return null;

  const app = sentryApps[appId];
  if (!app.enabled) return null;

  return { active: true, app, dsn: SENTRY_DSN };
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @workspace/observability test`

Expected: PASS (3 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/observability/keys.ts packages/observability/src/sentry-config.ts packages/observability/src/sentry-config.test.ts
git commit -m "feat(observability): add Sentry keys and central config"
```

---

### Task 3: Capture API (TDD)

**Files:**
- Create: `packages/observability/src/capture.ts`
- Create: `packages/observability/src/capture.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/node", () => ({
  captureException: vi.fn(),
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { addBreadcrumb, captureException, setUser } from "./capture";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("capture API without SENTRY_DSN", () => {
  it("captureException does not call Sentry", () => {
    vi.stubEnv("SENTRY_DSN", "");
    captureException(new Error("test"));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("setUser does not call Sentry", () => {
    vi.stubEnv("SENTRY_DSN", "");
    setUser({ id: "u1", email: "a@b.com" });
    expect(Sentry.setUser).not.toHaveBeenCalled();
  });

  it("addBreadcrumb does not call Sentry", () => {
    vi.stubEnv("SENTRY_DSN", "");
    addBreadcrumb({ message: "hello" });
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @workspace/observability test src/capture.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `capture.ts`**

```typescript
import * as Sentry from "@sentry/node";
import { keys } from "../keys";

function isActive(): boolean {
  return Boolean(keys().SENTRY_DSN);
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!isActive()) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Never throw from observability helpers
  }
}

export function setUser(user: { id: string; email?: string } | null): void {
  if (!isActive()) return;
  try {
    Sentry.setUser(user);
  } catch {
    // no-op
  }
}

export function addBreadcrumb(breadcrumb: {
  message: string;
  category?: string;
  data?: Record<string, unknown>;
}): void {
  if (!isActive()) return;
  try {
    Sentry.addBreadcrumb(breadcrumb);
  } catch {
    // no-op
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @workspace/observability test src/capture.test.ts`

Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/capture.ts packages/observability/src/capture.test.ts
git commit -m "feat(observability): add no-op-safe capture helpers"
```

---

### Task 4: Next.js init helpers (TDD)

**Files:**
- Create: `packages/observability/src/next/init.ts`
- Create: `packages/observability/src/next/init.test.ts`
- Create: `packages/observability/src/next/with-sentry-config.ts`
- Create: `packages/observability/src/next/global-error.tsx`
- Create: `packages/observability/src/next/index.ts`

- [ ] **Step 1: Write failing tests for `createInitOptions`**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitOptions } from "./init";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createInitOptions()", () => {
  it("returns null when DSN is missing", () => {
    vi.stubEnv("SENTRY_DSN", "");
    expect(createInitOptions("dashboard")).toBeNull();
  });

  it("returns errors-only options with app tag", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");

    const options = createInitOptions("dashboard");

    expect(options).not.toBeNull();
    expect(options!.dsn).toBe("https://key@o1.ingest.sentry.io/1");
    expect(options!.initialScope?.tags?.app).toBe("dashboard");
    expect(options!.integrations).toEqual([]);
    expect(options!.tracesSampleRate).toBeUndefined();
    expect(options!.replaysSessionSampleRate).toBeUndefined();
    expect(options!.enableLogs).toBeUndefined();
  });

  it("returns null for disabled app", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    expect(createInitOptions("public-api")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @workspace/observability test src/next/init.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `init.ts`**

```typescript
import * as Sentry from "@sentry/nextjs";
import type { BrowserOptions, EdgeOptions, NodeOptions } from "@sentry/nextjs";
import { clientDsn } from "../../keys";
import { resolveSentryConfig, type SentryAppId } from "../sentry-config";

type InitOptions = NodeOptions | BrowserOptions | EdgeOptions;

function buildBaseOptions(
  appId: SentryAppId,
  dsn: string,
): InitOptions {
  const resolved = resolveSentryConfig(appId);
  if (!resolved) {
    throw new Error("resolveSentryConfig must be checked before buildBaseOptions");
  }

  const integrations: InitOptions["integrations"] = [];

  // v1: errors only — tracing/replay/logs integrations added when config flags flip true

  return {
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    initialScope: {
      tags: { app: appId },
    },
    integrations,
    beforeSend(event, hint) {
      const error = hint.originalException;
      if (error instanceof Error) {
        if (error.name === "AbortError") return null;
        if (error.message.includes("Hydration failed")) return null;
        if (error.message.includes("cancelled")) return null;
      }
      return event;
    },
  };
}

export function createInitOptions(appId: SentryAppId): InitOptions | null {
  const resolved = resolveSentryConfig(appId);
  if (!resolved || !resolved.app.errors) return null;
  return buildBaseOptions(appId, resolved.dsn);
}

function safeInit(appId: SentryAppId, dsn: string | undefined): void {
  if (!dsn) return;
  const options = createInitOptions(appId);
  if (!options) return;
  try {
    Sentry.init({ ...options, dsn });
  } catch (err) {
    console.error("[observability] Sentry init failed:", err);
  }
}

export function initClientSentry(appId: SentryAppId): void {
  safeInit(appId, clientDsn());
}

export function initServerSentry(appId: SentryAppId): void {
  safeInit(appId, resolveSentryConfig(appId)?.dsn);
}

export function initEdgeSentry(appId: SentryAppId): void {
  safeInit(appId, resolveSentryConfig(appId)?.dsn);
}
```

Apps use Sentry's standard `instrumentation.ts` pattern (Task 6) — dynamic-import `sentry.server.config.ts` / `sentry.edge.config.ts`, which call `initServerSentry` / `initEdgeSentry`. Do **not** add a `registerObservability` export.

- [ ] **Step 4: Implement `with-sentry-config.ts`**

```typescript
import { withSentryConfig as sentryWithSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import type { SentryAppId } from "../sentry-config";

export function withSentryConfig(
  nextConfig: NextConfig,
  _appId: SentryAppId,
): NextConfig {
  const configWithEnv: NextConfig = {
    ...nextConfig,
    env: {
      ...nextConfig.env,
      // Single user-facing env var; exposed to client bundle at build time
      NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN ?? "",
    },
  };

  return sentryWithSentryConfig(configWithEnv, {
    silent: !process.env.CI,
  });
}
```

- [ ] **Step 5: Implement `global-error.tsx`**

```tsx
"use client";

import * as Sentry from "@sentry/nextjs";
import NextError from "next/error";
import { useEffect } from "react";

export function createGlobalError(_appId: string) {
  return function GlobalError({
    error,
  }: {
    error: Error & { digest?: string };
  }) {
    useEffect(() => {
      Sentry.captureException(error);
    }, [error]);

    return (
      <html lang="en">
        <body>
          <NextError statusCode={0} />
        </body>
      </html>
    );
  };
}
```

- [ ] **Step 6: Implement `index.ts` barrel**

```typescript
export {
  createInitOptions,
  initClientSentry,
  initServerSentry,
  initEdgeSentry,
} from "./init";
export { withSentryConfig } from "./with-sentry-config";
export { createGlobalError } from "./global-error";
```

- [ ] **Step 7: Run tests — expect PASS**

Run: `pnpm --filter @workspace/observability test`

Expected: PASS (all tests).

- [ ] **Step 8: Commit**

```bash
git add packages/observability/src/next/
git commit -m "feat(observability): add Next.js Sentry init helpers"
```

---

### Task 5: Node init (TDD)

**Files:**
- Create: `packages/observability/src/node/init.ts`
- Create: `packages/observability/src/node/init.test.ts`

- [ ] **Step 1: Write failing test**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { initNodeObservability } from "./init";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("initNodeObservability()", () => {
  it("does not init when app is disabled", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    initNodeObservability("public-api");
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("inits when app is enabled and DSN set", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    initNodeObservability("dashboard");
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@o1.ingest.sentry.io/1",
      }),
    );
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @workspace/observability test src/node/init.test.ts`

Expected: FAIL.

- [ ] **Step 3: Implement `node/init.ts`**

```typescript
import * as Sentry from "@sentry/node";
import { resolveSentryConfig, type SentryAppId } from "../sentry-config";

export function initNodeObservability(appId: SentryAppId): void {
  const resolved = resolveSentryConfig(appId);
  if (!resolved || !resolved.app.errors) return;

  try {
    Sentry.init({
      dsn: resolved.dsn,
      environment: process.env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      initialScope: {
        tags: { app: appId },
      },
    });
  } catch (err) {
    console.error("[observability] Sentry node init failed:", err);
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @workspace/observability test`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/node/
git commit -m "feat(observability): add Node Sentry init helper"
```

---

### Task 6: Wire `apps/dashboard`

**Files:**
- Modify: `apps/dashboard/package.json` — add `@workspace/observability`
- Modify: `apps/dashboard/next.config.ts`
- Create: `apps/dashboard/instrumentation.ts`
- Create: `apps/dashboard/instrumentation-client.ts`
- Create: `apps/dashboard/sentry.server.config.ts`
- Create: `apps/dashboard/sentry.edge.config.ts`
- Create: `apps/dashboard/app/global-error.tsx`

- [ ] **Step 1: Add dependency**

In `apps/dashboard/package.json` dependencies:

```json
"@workspace/observability": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 2: Update `next.config.ts`**

```typescript
import type { NextConfig } from "next";
import path from "path";
import { assertPublicMcpEnv } from "@workspace/common/env/public-mcp";
import { withSentryConfig } from "@workspace/observability/next";

assertPublicMcpEnv();

const nextConfig: NextConfig = {
  transpilePackages: [
    "@workspace/common",
    "@workspace/routes",
    "@workspace/observability",
  ],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  devIndicators: {
    position: "bottom-right",
  },
};

export default withSentryConfig(nextConfig, "dashboard");
```

- [ ] **Step 3: Create `instrumentation.ts`**

```typescript
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

- [ ] **Step 4: Create `instrumentation-client.ts`**

```typescript
import { initClientSentry } from "@workspace/observability/next";

initClientSentry("dashboard");
```

- [ ] **Step 5: Create `sentry.server.config.ts`**

```typescript
import { initServerSentry } from "@workspace/observability/next";

initServerSentry("dashboard");
```

- [ ] **Step 6: Create `sentry.edge.config.ts`**

```typescript
import { initEdgeSentry } from "@workspace/observability/next";

initEdgeSentry("dashboard");
```

- [ ] **Step 7: Create `app/global-error.tsx`**

```tsx
"use client";

import { createGlobalError } from "@workspace/observability/next";

export default createGlobalError("dashboard");
```

- [ ] **Step 8: Type-check dashboard**

Run: `pnpm --filter @apps/dashboard type-check`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/
git commit -m "feat(dashboard): wire Sentry error monitoring"
```

---

### Task 7: Dashboard user context sync

**Files:**
- Create: `apps/dashboard/features/observability/ui/sentry-user-sync.tsx`
- Modify: `apps/dashboard/features/auth/ui/auth-provider.tsx`

- [ ] **Step 1: Create `sentry-user-sync.tsx`**

```tsx
"use client";

import { setUser } from "@workspace/observability/capture";
import { useEffect } from "react";
import { authClient } from "@/features/auth/data/auth-client";

export function SentryUserSync() {
  const { data: session } = authClient.useSession();

  useEffect(() => {
    const user = session?.user;
    if (user) {
      setUser({ id: user.id, email: user.email });
    } else {
      setUser(null);
    }
  }, [session?.user]);

  return null;
}
```

- [ ] **Step 2: Mount in `auth-provider.tsx`**

Add import and render inside `Providers`:

```tsx
import { SentryUserSync } from "@/features/observability/ui/sentry-user-sync";

// inside Providers return, after ThemeProvider opens:
<SentryUserSync />
```

- [ ] **Step 3: Lint dashboard**

Run: `pnpm --filter @apps/dashboard lint`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/features/observability/ apps/dashboard/features/auth/ui/auth-provider.tsx
git commit -m "feat(dashboard): sync auth session user to Sentry"
```

---

### Task 8: Wire `apps/www`

**Files:**
- Modify: `apps/www/package.json`
- Modify: `apps/www/next.config.ts`
- Create: `apps/www/instrumentation.ts`
- Create: `apps/www/instrumentation-client.ts`
- Create: `apps/www/sentry.server.config.ts`
- Create: `apps/www/sentry.edge.config.ts`
- Create: `apps/www/app/global-error.tsx`

- [ ] **Step 1: Add dependency and install**

```json
"@workspace/observability": "workspace:*"
```

Run: `pnpm install`

- [ ] **Step 2: Update `next.config.ts`**

Same pattern as dashboard but app id `"www"` and existing transpilePackages:

```typescript
import type { NextConfig } from "next";
import path from "path";
import { withSentryConfig } from "@workspace/observability/next";

const nextConfig: NextConfig = {
  transpilePackages: [
    "@workspace/common",
    "@workspace/routes",
    "@workspace/observability",
  ],
  turbopack: {
    root: path.resolve(__dirname, "../.."),
  },
  devIndicators: {
    position: "bottom-right",
  },
};

export default withSentryConfig(nextConfig, "www");
```

- [ ] **Step 3: Create Sentry wiring files**

Copy dashboard files from Task 6, replacing `"dashboard"` with `"www"` in:
- `instrumentation-client.ts`
- `sentry.server.config.ts`
- `sentry.edge.config.ts`
- `app/global-error.tsx`

`instrumentation.ts` is identical (no app id).

- [ ] **Step 4: Type-check www**

Run: `pnpm --filter @apps/www type-check`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/www/
git commit -m "feat(www): wire Sentry error monitoring"
```

---

### Task 9: `.env.example` + package README

**Files:**
- Modify: `.env.example`
- Create: `packages/observability/README.md`

- [ ] **Step 1: Add to `.env.example`** (after Langfuse section)

```bash
# ── Sentry (@workspace/observability) ───────────────────────────────────────
# Optional — unset in local dev. Enables error monitoring in dashboard + www.
# SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>
```

- [ ] **Step 2: Create `packages/observability/README.md`**

Document:
- Single env var `SENTRY_DSN`
- All toggles in `src/sentry-config.ts`
- How to enable tracing/logs/replay later (flip flags in config)
- How to wire node apps (`initNodeObservability("workers")` + set `enabled: true`)
- Langfuse remains separate in `@workspace/ai`

- [ ] **Step 3: Commit**

```bash
git add .env.example packages/observability/README.md
git commit -m "docs(observability): document Sentry setup"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run full test suite for observability**

Run: `pnpm --filter @workspace/observability test`

Expected: All tests PASS.

- [ ] **Step 2: Run monorepo type-check**

Run: `pnpm type-check`

Expected: PASS.

- [ ] **Step 3: Run monorepo lint**

Run: `pnpm lint`

Expected: PASS.

- [ ] **Step 4: Manual smoke test (optional, requires Sentry project)**

1. Set `SENTRY_DSN` in root `.env`
2. Start dashboard: `pnpm --filter @apps/dashboard dev`
3. Add a temporary throw button or visit a route that errors
4. Confirm event in Sentry with tag `app:dashboard`

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "fix(observability): address review findings from verification"
```

(Skip if no fixups needed.)

---

## Verification checklist

- [ ] `pnpm --filter @workspace/observability test`
- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] Dashboard and www build without errors when `SENTRY_DSN` is unset
- [ ] No new required env vars beyond optional `SENTRY_DSN`
