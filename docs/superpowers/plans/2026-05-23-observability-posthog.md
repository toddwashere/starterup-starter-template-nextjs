# Observability Package — PostHog Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `@workspace/observability` with PostHog product analytics (autocapture + pageviews + identify on dashboard), wired into `apps/dashboard` and `apps/www`, with no-op-safe helpers when `NEXT_PUBLIC_POSTHOG_TOKEN` is unset.

**Architecture:** All PostHog toggles live in `packages/observability/src/posthog-config.ts`. Apps call `initClientPostHog("<app>")` from `instrumentation-client.ts` alongside existing Sentry init. Dashboard mounts `PostHogUserSync` next to `SentryUserSync`. Run the PostHog wizard once on dashboard to capture SDK version and init options, then refactor into the shared package.

**Tech Stack:** `posthog-js`, `posthog-node`, Next.js 16 App Router, Zod, Vitest.

**Design spec:** [`docs/superpowers/specs/2026-05-23-observability-posthog-design.md`](../specs/2026-05-23-observability-posthog-design.md)

**Prerequisite:** Sentry observability work merged to `main` (`packages/observability` must exist with Sentry wiring in dashboard + www).

**Worktree:** Implement in `.worktrees/feat-observability-posthog` on branch `feat/observability-posthog` (see Task 0).

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/observability/keys.ts` | Extend with `NEXT_PUBLIC_POSTHOG_TOKEN` + `NEXT_PUBLIC_POSTHOG_HOST` |
| `packages/observability/package.json` | Add PostHog deps + subpath exports |
| `packages/observability/src/posthog-config.ts` | Per-app toggles + `resolvePostHogConfig()` |
| `packages/observability/src/posthog/init.ts` | `createClientInitOptions`, `initClientPostHog` |
| `packages/observability/src/posthog/analytics.ts` | No-op-safe `capture`, `identify`, `reset` |
| `packages/observability/src/posthog/index.ts` | Re-exports |
| `packages/observability/src/posthog-node/init.ts` | `initNodePostHog(appId)` — built, unwired |
| `apps/dashboard/instrumentation-client.ts` | Add `initClientPostHog("dashboard")` |
| `apps/dashboard/features/observability/ui/posthog-user-sync.tsx` | Sync session user to PostHog |
| `apps/dashboard/features/auth/ui/auth-provider.tsx` | Mount `PostHogUserSync` |
| `apps/www/instrumentation-client.ts` | Add `initClientPostHog("www")` |
| `.env.example` | Commented PostHog env vars |

---

## Critical Tests

- `packages/observability/src/posthog-config.test.ts`: `resolvePostHogConfig("dashboard")` active when token + app enabled; `null` when token missing or app disabled.
- `packages/observability/src/posthog/init.test.ts`: `createClientInitOptions("dashboard")` analytics-only — `advanced_disable_feature_flags: true`, no replay; disabled app returns `null`; `initClientPostHog` no-ops when token unset.
- `packages/observability/src/posthog/analytics.test.ts`: `capture` / `identify` / `reset` no-op when token unset — no throw, no SDK call.
- `packages/observability/src/posthog-node/init.test.ts`: `initNodePostHog("public-api")` no-ops when app disabled.

---

### Task 0: Prerequisites + isolated worktree

**Files:**
- Create: `.worktrees/feat-observability-posthog/` (git worktree checkout)

- [ ] **Step 1: Verify Sentry observability is on `main`**

Run from repo root:

```bash
git show main:packages/observability/package.json >/dev/null 2>&1 && echo "OK: observability package on main" || echo "BLOCKED: merge Sentry observability to main first"
```

Expected: `OK: observability package on main`. If BLOCKED, stop — merge Sentry first.

- [ ] **Step 2: Verify worktree directory is gitignored**

Run:

```bash
git check-ignore -q .worktrees && echo "ignored" || echo "NOT ignored — add .worktrees/ to .gitignore first"
```

Expected: `ignored`.

- [ ] **Step 3: Create worktree from `main`**

Run from repo root:

```bash
git fetch origin main 2>/dev/null || true
git worktree add .worktrees/feat-observability-posthog -b feat/observability-posthog main
```

Expected: worktree created at `.worktrees/feat-observability-posthog`.

- [ ] **Step 4: Install dependencies in worktree**

Run:

```bash
cd .worktrees/feat-observability-posthog && pnpm install
```

Expected: install succeeds.

- [ ] **Step 5: Baseline verification**

Run:

```bash
pnpm --filter @workspace/observability test
pnpm type-check
```

Expected: observability tests PASS; type-check PASS.

- [ ] **Step 6: Commit (only if Step 2 required a `.gitignore` fix on `main`)**

Skip if no `.gitignore` change was needed.

---

### Task 1: PostHog wizard bootstrap (dashboard)

**Files:**
- Modify (temporary — refactor in later tasks): `apps/dashboard/instrumentation-client.ts`, possibly `apps/dashboard/package.json`, `.env.example`

Run all steps from worktree root: `.worktrees/feat-observability-posthog`.

- [ ] **Step 1: Run the PostHog wizard against dashboard**

Interactive (preferred when developer is present):

```bash
npx @posthog/wizard@latest --integration nextjs --install-dir apps/dashboard
```

If non-interactive CI/automation is required and a PostHog personal API key is available:

```bash
npx @posthog/wizard@latest --ci --default --integration nextjs --install-dir apps/dashboard --api-key "$POSTHOG_PERSONAL_API_KEY"
```

Expected: wizard installs `posthog-js` (note exact version), adds env var placeholders, creates or updates client init in dashboard.

- [ ] **Step 2: Record wizard output for refactor**

Note in your session (or a scratch comment, not committed):
- `posthog-js` version installed
- Exact init options the wizard used (especially `defaults`, `api_host`, autocapture flags)
- Any files created (e.g. `posthog.ts`, provider components, reverse-proxy rewrites in `next.config.ts`)

**Do not commit wizard output as-is** — Tasks 2–8 refactor into `@workspace/observability`.

- [ ] **Step 3: If wizard cannot run (no network / no API key)**

Skip wizard and use PostHog docs defaults:
- Install `posthog-js@^1` and `posthog-node@^4` in `@workspace/observability` (Task 2)
- Use init options from design spec (`defaults: '2026-01-30'`, `person_profiles: 'identified_only'`, etc.)

---

### Task 2: Add PostHog dependencies and exports

**Files:**
- Modify: `packages/observability/package.json`

- [ ] **Step 1: Add dependencies and exports**

Add to `dependencies`:

```json
"posthog-js": "^1.260.0",
"posthog-node": "^4.18.0"
```

Use wizard-noted versions if they differ. Add to `exports`:

```json
"./posthog-config": "./src/posthog-config.ts",
"./posthog": "./src/posthog/index.ts",
"./posthog/node": "./src/posthog-node/init.ts"
```

- [ ] **Step 2: Install**

Run: `pnpm install`

Expected: lockfile updated, no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/observability/package.json pnpm-lock.yaml
git commit -m "chore(observability): add PostHog dependencies and exports"
```

---

### Task 3: Extend `keys.ts` + `posthog-config.ts` (TDD)

**Files:**
- Modify: `packages/observability/keys.ts`
- Create: `packages/observability/src/posthog-config.ts`
- Create: `packages/observability/src/posthog-config.test.ts`

- [ ] **Step 1: Write failing tests for `resolvePostHogConfig`**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePostHogConfig } from "./posthog-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolvePostHogConfig()", () => {
  it("returns active config for dashboard when token is set", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test_token");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");

    const result = resolvePostHogConfig("dashboard");

    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.app.analytics).toBe(true);
    expect(result!.token).toBe("phc_test_token");
    expect(result!.host).toBe("https://us.i.posthog.com");
  });

  it("uses NEXT_PUBLIC_POSTHOG_HOST when set", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");

    const result = resolvePostHogConfig("dashboard");

    expect(result!.host).toBe("https://eu.i.posthog.com");
  });

  it("returns null when token is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");

    expect(resolvePostHogConfig("dashboard")).toBeNull();
  });

  it("returns null when app is disabled in config", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    expect(resolvePostHogConfig("public-api")).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @workspace/observability test src/posthog-config.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Extend `keys.ts`**

Add PostHog fields to the existing Zod schema (keep Sentry fields unchanged):

```typescript
const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

const schema = z.object({
  SENTRY_DSN: optionalString,
  NEXT_PUBLIC_POSTHOG_TOKEN: optionalString,
  NEXT_PUBLIC_POSTHOG_HOST: optionalString,
});

export function keys() {
  const parsed = schema.parse({
    SENTRY_DSN: process.env.SENTRY_DSN,
    NEXT_PUBLIC_POSTHOG_TOKEN: process.env.NEXT_PUBLIC_POSTHOG_TOKEN,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });

  return {
    ...parsed,
    posthogHost: parsed.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
  };
}
```

Update any existing `keys()` callers/tests if return shape changed — spread preserves `SENTRY_DSN` access.

- [ ] **Step 4: Implement `posthog-config.ts`**

```typescript
import { keys } from "../keys";

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
  "public-api": {
    enabled: false,
    analytics: true,
    featureFlags: false,
    sessionReplay: false,
    autocapture: false,
    capturePageview: false,
    capturePageleave: false,
  },
  workers: {
    enabled: false,
    analytics: true,
    featureFlags: false,
    sessionReplay: false,
    autocapture: false,
    capturePageview: false,
    capturePageleave: false,
  },
  "public-mcp": {
    enabled: false,
    analytics: true,
    featureFlags: false,
    sessionReplay: false,
    autocapture: false,
    capturePageview: false,
    capturePageleave: false,
  },
};

export function resolvePostHogConfig(appId: PostHogAppId): {
  active: boolean;
  app: PostHogAppConfig;
  token: string;
  host: string;
} | null {
  const { NEXT_PUBLIC_POSTHOG_TOKEN, posthogHost } = keys();
  if (!NEXT_PUBLIC_POSTHOG_TOKEN) return null;

  const app = posthogApps[appId];
  if (!app.enabled) return null;

  return {
    active: true,
    app,
    token: NEXT_PUBLIC_POSTHOG_TOKEN,
    host: posthogHost,
  };
}
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @workspace/observability test src/posthog-config.test.ts`

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/observability/keys.ts packages/observability/src/posthog-config.ts packages/observability/src/posthog-config.test.ts
git commit -m "feat(observability): add PostHog keys and central config"
```

---

### Task 4: Client init helpers (TDD)

**Files:**
- Create: `packages/observability/src/posthog/init.ts`
- Create: `packages/observability/src/posthog/init.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockInit = vi.fn();
const mockRegister = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    init: mockInit,
    register: mockRegister,
  },
}));

import {
  createClientInitOptions,
  initClientPostHog,
  isPostHogClientActive,
} from "./init";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("createClientInitOptions()", () => {
  it("returns analytics-only options for dashboard", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    const result = createClientInitOptions("dashboard");

    expect(result).not.toBeNull();
    expect(result!.token).toBe("phc_test");
    expect(result!.options.api_host).toBe("https://us.i.posthog.com");
    expect(result!.options.advanced_disable_feature_flags).toBe(true);
    expect(result!.options.disable_session_recording).toBe(true);
    expect(result!.options.person_profiles).toBe("identified_only");
    expect(result!.options.autocapture).toBe(true);
    expect(result!.options.capture_pageview).toBe(true);
  });

  it("returns null when token is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");

    expect(createClientInitOptions("dashboard")).toBeNull();
  });

  it("returns null when app is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    expect(createClientInitOptions("public-api")).toBeNull();
  });
});

describe("initClientPostHog()", () => {
  it("calls posthog.init when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    initClientPostHog("dashboard");

    expect(mockInit).toHaveBeenCalledOnce();
    expect(isPostHogClientActive()).toBe(true);
  });

  it("no-ops when token is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");

    initClientPostHog("dashboard");

    expect(mockInit).not.toHaveBeenCalled();
    expect(isPostHogClientActive()).toBe(false);
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @workspace/observability test src/posthog/init.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `init.ts`**

```typescript
import posthog from "posthog-js";
import {
  resolvePostHogConfig,
  type PostHogAppId,
} from "../posthog-config";

export type PostHogClientInit = {
  token: string;
  options: Parameters<typeof posthog.init>[1];
};

let clientActive = false;

export function isPostHogClientActive(): boolean {
  return clientActive;
}

function buildInitOptions(
  appId: PostHogAppId,
  host: string,
  app: NonNullable<ReturnType<typeof resolvePostHogConfig>>["app"],
): NonNullable<Parameters<typeof posthog.init>[1]> {
  return {
    api_host: host,
    // Match PostHog wizard/docs — update if wizard used a different defaults pin
    defaults: "2026-01-30",
    autocapture: app.autocapture,
    capture_pageview: app.capturePageview,
    capture_pageleave: app.capturePageleave,
    person_profiles: "identified_only",
    advanced_disable_feature_flags: !app.featureFlags,
    disable_session_recording: !app.sessionReplay,
    loaded: (ph) => {
      ph.register({ app: appId });
    },
  };
}

export function createClientInitOptions(
  appId: PostHogAppId,
): PostHogClientInit | null {
  const resolved = resolvePostHogConfig(appId);
  if (!resolved || !resolved.app.analytics) return null;

  return {
    token: resolved.token,
    options: buildInitOptions(appId, resolved.host, resolved.app),
  };
}

export function initClientPostHog(appId: PostHogAppId): void {
  const config = createClientInitOptions(appId);
  if (!config) return;

  try {
    posthog.init(config.token, config.options);
    clientActive = true;
  } catch (err) {
    console.error("[observability] PostHog init failed:", err);
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @workspace/observability test src/posthog/init.test.ts`

Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/posthog/init.ts packages/observability/src/posthog/init.test.ts
git commit -m "feat(observability): add PostHog client init helpers"
```

---

### Task 5: Analytics API (TDD)

**Files:**
- Create: `packages/observability/src/posthog/analytics.ts`
- Create: `packages/observability/src/posthog/analytics.test.ts`
- Create: `packages/observability/src/posthog/index.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

const mockCapture = vi.fn();
const mockIdentify = vi.fn();
const mockReset = vi.fn();

vi.mock("posthog-js", () => ({
  default: {
    capture: mockCapture,
    identify: mockIdentify,
    reset: mockReset,
  },
}));

vi.mock("./init", () => ({
  isPostHogClientActive: vi.fn(() => false),
}));

import { isPostHogClientActive } from "./init";
import { capture, identify, reset } from "./analytics";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.mocked(isPostHogClientActive).mockReturnValue(false);
});

describe("analytics API when inactive", () => {
  it("capture does not call posthog", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");
    capture("test_event");
    expect(mockCapture).not.toHaveBeenCalled();
  });

  it("identify does not call posthog", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");
    identify("u1", { email: "a@b.com" });
    expect(mockIdentify).not.toHaveBeenCalled();
  });

  it("reset does not call posthog", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");
    reset();
    expect(mockReset).not.toHaveBeenCalled();
  });
});

describe("analytics API when active", () => {
  it("capture forwards event and properties", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");
    vi.mocked(isPostHogClientActive).mockReturnValue(true);

    capture("button_clicked", { plan: "pro" });

    expect(mockCapture).toHaveBeenCalledWith("button_clicked", { plan: "pro" });
  });

  it("identify forwards user id and properties", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");
    vi.mocked(isPostHogClientActive).mockReturnValue(true);

    identify("u1", { email: "a@b.com" });

    expect(mockIdentify).toHaveBeenCalledWith("u1", { email: "a@b.com" });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @workspace/observability test src/posthog/analytics.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `analytics.ts`**

```typescript
import posthog from "posthog-js";
import { keys } from "../../keys";
import { isPostHogClientActive } from "./init";

function canCapture(): boolean {
  return Boolean(keys().NEXT_PUBLIC_POSTHOG_TOKEN) && isPostHogClientActive();
}

export function capture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!canCapture()) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Never throw from observability helpers
  }
}

export function identify(
  userId: string,
  properties?: { email?: string },
): void {
  if (!canCapture()) return;
  try {
    posthog.identify(userId, properties);
  } catch {
    // no-op
  }
}

export function reset(): void {
  if (!canCapture()) return;
  try {
    posthog.reset();
  } catch {
    // no-op
  }
}
```

- [ ] **Step 4: Create `index.ts`**

```typescript
export {
  createClientInitOptions,
  initClientPostHog,
  isPostHogClientActive,
} from "./init";
export { capture, identify, reset } from "./analytics";
```

- [ ] **Step 5: Run tests — expect PASS**

Run: `pnpm --filter @workspace/observability test src/posthog/`

Expected: PASS (all posthog tests).

- [ ] **Step 6: Commit**

```bash
git add packages/observability/src/posthog/
git commit -m "feat(observability): add no-op-safe PostHog analytics API"
```

---

### Task 6: Node init stub (TDD)

**Files:**
- Create: `packages/observability/src/posthog-node/init.ts`
- Create: `packages/observability/src/posthog-node/init.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { afterEach, describe, expect, it, vi } from "vitest";

const MockPostHog = vi.fn();

vi.mock("posthog-node", () => ({
  PostHog: MockPostHog,
}));

import { initNodePostHog } from "./init";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("initNodePostHog()", () => {
  it("does not construct PostHog when app is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    initNodePostHog("public-api");

    expect(MockPostHog).not.toHaveBeenCalled();
  });

  it("constructs PostHog when app is enabled and token is set", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    initNodePostHog("dashboard");

    expect(MockPostHog).toHaveBeenCalledWith("phc_test", {
      host: "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  });
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `pnpm --filter @workspace/observability test src/posthog-node/init.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `posthog-node/init.ts`**

```typescript
import { PostHog } from "posthog-node";
import { resolvePostHogConfig, type PostHogAppId } from "../posthog-config";

let nodeClient: PostHog | null = null;

export function getNodePostHog(): PostHog | null {
  return nodeClient;
}

export function initNodePostHog(appId: PostHogAppId): PostHog | null {
  const resolved = resolvePostHogConfig(appId);
  if (!resolved || !resolved.app.analytics) return null;

  try {
    nodeClient = new PostHog(resolved.token, {
      host: resolved.host,
      flushAt: 1,
      flushInterval: 0,
    });
    return nodeClient;
  } catch (err) {
    console.error("[observability] PostHog node init failed:", err);
    return null;
  }
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `pnpm --filter @workspace/observability test src/posthog-node/init.test.ts`

Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/observability/src/posthog-node/
git commit -m "feat(observability): add PostHog node init stub"
```

---

### Task 7: Wire dashboard PostHog + clean up wizard artifacts

**Files:**
- Modify: `apps/dashboard/instrumentation-client.ts`
- Create: `apps/dashboard/features/observability/ui/posthog-user-sync.tsx`
- Modify: `apps/dashboard/features/auth/ui/auth-provider.tsx`
- Delete (if wizard created them): any duplicate app-local PostHog init files (e.g. `apps/dashboard/lib/posthog.ts`, standalone provider wrappers)

- [ ] **Step 1: Update `instrumentation-client.ts`**

Replace wizard-generated PostHog init with package delegate. Keep existing Sentry init:

```typescript
import { initClientSentry } from "@workspace/observability/next";
import { initClientPostHog } from "@workspace/observability/posthog";

initClientSentry("dashboard");
initClientPostHog("dashboard");
```

- [ ] **Step 2: Remove wizard duplication**

Delete any app-local PostHog files the wizard added that duplicate package logic. Remove `posthog-js` from `apps/dashboard/package.json` if wizard added it there — dependency lives in `@workspace/observability` only.

Remove any reverse-proxy rewrites the wizard added to `next.config.ts` (out of v1 scope per spec).

- [ ] **Step 3: Create `posthog-user-sync.tsx`**

```tsx
"use client";

import { identify, reset } from "@workspace/observability/posthog";
import { useEffect } from "react";
import { authClient } from "@/features/auth/data/auth-client";

export function PostHogUserSync() {
  const { data: session } = authClient.useSession();

  const userId = session?.user?.id;
  const userEmail = session?.user?.email;

  useEffect(() => {
    if (userId) {
      identify(userId, { email: userEmail ?? undefined });
    } else {
      reset();
    }
  }, [userId, userEmail]);

  return null;
}
```

- [ ] **Step 4: Mount in `auth-provider.tsx`**

Add import and render alongside `SentryUserSync`:

```tsx
import { PostHogUserSync } from "@/features/observability/ui/posthog-user-sync";
```

Inside `Providers`:

```tsx
<SentryUserSync />
<PostHogUserSync />
```

- [ ] **Step 5: Type-check dashboard**

Run: `pnpm --filter @apps/dashboard type-check`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/
git commit -m "feat(dashboard): wire PostHog analytics and user identify"
```

---

### Task 8: Wire www PostHog

**Files:**
- Modify: `apps/www/instrumentation-client.ts`

- [ ] **Step 1: Update `instrumentation-client.ts`**

```typescript
import { initClientSentry } from "@workspace/observability/next";
import { initClientPostHog } from "@workspace/observability/posthog";

initClientSentry("www");
initClientPostHog("www");
```

- [ ] **Step 2: Type-check www**

Run: `pnpm --filter @apps/www type-check`

Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add apps/www/instrumentation-client.ts
git commit -m "feat(www): wire PostHog anonymous analytics"
```

---

### Task 9: `.env.example` + README

**Files:**
- Modify: `.env.example`
- Modify: `packages/observability/README.md` (create if missing)

- [ ] **Step 1: Add PostHog section to `.env.example`**

After the Sentry section (or at end of observability block):

```bash
# ── PostHog (@workspace/observability) ─────────────────────────────────────
# Optional — unset in local dev. Enables product analytics in dashboard + www.
# NEXT_PUBLIC_POSTHOG_TOKEN=phc_...
# NEXT_PUBLIC_POSTHOG_HOST=https://us.i.posthog.com
```

- [ ] **Step 2: Extend `packages/observability/README.md`**

Add a PostHog section documenting:
- Env vars `NEXT_PUBLIC_POSTHOG_TOKEN` + `NEXT_PUBLIC_POSTHOG_HOST`
- All toggles in `src/posthog-config.ts`
- How to enable feature flags / session replay later (flip flags in config)
- How to wire node apps (`initNodePostHog("workers")` + set `enabled: true`)
- Sentry and Langfuse remain separate

- [ ] **Step 3: Commit**

```bash
git add .env.example packages/observability/README.md
git commit -m "docs(observability): document PostHog setup"
```

---

### Task 10: Final verification

- [ ] **Step 1: Run observability tests**

Run: `pnpm --filter @workspace/observability test`

Expected: All tests PASS.

- [ ] **Step 2: Run monorepo type-check**

Run: `pnpm type-check`

Expected: PASS.

- [ ] **Step 3: Run monorepo lint**

Run: `pnpm lint`

Expected: PASS.

- [ ] **Step 4: Manual smoke test (optional, requires PostHog project)**

1. Set `NEXT_PUBLIC_POSTHOG_TOKEN` and `NEXT_PUBLIC_POSTHOG_HOST` in root `.env`
2. Start dashboard: `pnpm --filter @apps/dashboard dev`
3. Open dashboard in browser, click around
4. Confirm autocapture events in PostHog with property `app: dashboard`
5. Sign in and confirm person profile created with user id

- [ ] **Step 5: Commit any fixups**

```bash
git add -A
git commit -m "fix(observability): address review findings from PostHog verification"
```

(Skip if no fixups needed.)

---

## Verification checklist

- [ ] `pnpm --filter @workspace/observability test`
- [ ] `pnpm type-check`
- [ ] `pnpm lint`
- [ ] Dashboard + www dev servers start without errors when PostHog env vars unset (no-op)
- [ ] PostHog events appear when token is set (manual)
