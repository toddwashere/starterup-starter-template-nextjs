# Typed Env Validation Design

**Date:** 2026-05-23  
**Status:** Approved

## Overview

Standardize typed environment configuration across the monorepo critical path using the existing Zod `keys.ts` pattern (`packages/email`, `packages/ai`, `packages/worker-queue`). Add a root `pnpm validate:env` script that validates `.env.example` against all critical-path schemas so misconfiguration fails fast in local dev and CI.

No new dependencies. No ESLint ban on raw `process.env` in v1. Leaf packages remain unchanged.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **Approach** | Extend existing `keys.ts` + Zod (not `@t3-oss/env-nextjs`) |
| **Scope (v1)** | All apps + `auth`, `database`, `billing`, `worker-queue` |
| **Validation target** | `.env.example` (not developer `.env`) |
| **Root script** | `pnpm validate:env` → exit 0/1 with per-module errors |
| **ESLint enforcement** | Out of scope v1 |
| **Leaf packages** | `contacts`, `email`, `ai`, `tool-calls`, `routes`, `common`, `ui` — no migration required |

---

## Scope

### In scope

- `keys.ts` (or equivalent) for each critical-path unit listed below
- Migrate direct `process.env` reads in those units to `keys()`
- Root `scripts/validate-env.ts` + root `package.json` script `validate:env`
- `.env.example` parity checklist — every var in critical-path schemas appears in `.env.example`
- Unit tests for `keys()` and the validate script
- `.ai/conventions/` doc or skill trigger (optional follow-up in implementation plan)

### Out of scope (v1)

- ESLint rule blocking raw `process.env` outside `keys.ts`
- Migrating leaf packages
- Runtime validation in Next.js middleware
- Production secret management (Vault, Doppler, etc.)
- Validating developer `.env` files (only the committed template)

---

## Convention

Each package/app exposes `keys.ts` at its root:

```typescript
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().url(),
  // optional vars: z.string().optional()
  // defaults: z.string().default("http://localhost:4000")
});

export function keys() {
  return schema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
  });
}
```

**Rules:**

1. All `process.env` reads in scoped units go through `keys()` after migration.
2. Optional integration vars (OAuth, Resend) use `.optional()` — app works without them locally.
3. `NEXT_PUBLIC_*` vars live in **app** `keys.ts` (`dashboard`, `www`), not server-only packages.
4. Packages export `keys()` only; apps may also export typed helpers derived from `keys()` if needed.
5. Match existing pattern in `packages/email/keys.ts` and `packages/worker-queue/keys.ts`.

---

## Critical-path inventory

| Unit | `keys.ts` owns |
|------|----------------|
| `packages/database` | `DATABASE_URL` |
| `packages/auth` | `BETTER_AUTH_URL`, `GOOGLE_*`, `MICROSOFT_*`, auth secrets used in `auth.ts` |
| `packages/billing` | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, optional `STRIPE_PRICE_*` |
| `packages/worker-queue` | Already exists — align schema with `.env.example`; add worker health/poll vars if owned here vs `apps/workers` |
| `apps/dashboard` | `NEXT_PUBLIC_*` URLs, any app-specific vars |
| `apps/www` | Marketing/public URLs |
| `apps/public-api` | Port, auth-related URLs |
| `apps/public-mcp` | Port, MCP URLs |
| `apps/workers` | `WORKER_HEALTH_PORT`, `WORKER_POLL_INTERVAL_MS`, `WORKER_MAX_ATTEMPTS`; may compose `worker-queue` keys |
| `apps/email-preview` | Port / preview vars if any |

### Migration notes

- `packages/auth/src/auth.ts` — replace inline `process.env.GOOGLE_CLIENT_ID` conditionals with `keys()` output.
- `packages/billing/src/stripe-client.ts` — read `STRIPE_SECRET_KEY` via `keys()`.
- `packages/database/src/client.ts` — read `DATABASE_URL` via `keys()`.
- `apps/dashboard` — replace stray `process.env.NEXT_PUBLIC_*` / `BETTER_AUTH_URL` reads in route/components with app `keys()`.

---

## Root validate script

**Path:** `scripts/validate-env.ts`  
**Invocation:** `pnpm validate:env` (root `package.json`)

**Behavior:**

1. Load `.env.example` via `dotenv` (`path: ".env.example"`, `override: true`) so vars populate `process.env`.
2. Import and call each critical-path `keys()` function in sequence.
3. Collect Zod errors; print readable per-module failures (module name + field paths).
4. Exit `0` on success, `1` on any failure.

**Does not require:** live database, API keys, or network. Placeholders in `.env.example` must parse.

**Implementation detail:** use dynamic imports or a small registry array:

```typescript
const modules = [
  { name: "@workspace/database", validate: () => import("@workspace/database/keys").then(m => m.keys()) },
  // ...
];
```

If package exports for `keys` are not yet wired, add `"./keys": "./keys.ts"` to each package's `exports` field.

---

## `.env.example` sync

Every variable referenced in any critical-path Zod schema must appear in `.env.example` (with safe placeholder or commented optional entry). Implementation plan includes a manual checklist mapping schema fields ↔ `.env.example` lines.

When adding new env vars in future features, update both `keys.ts` and `.env.example` in the same PR.

---

## Architecture

```text
.env.example
     │
     ▼
scripts/validate-env.ts ──► loads into process.env
     │
     ├── packages/database/keys.ts
     ├── packages/auth/keys.ts
     ├── packages/billing/keys.ts
     ├── packages/worker-queue/keys.ts
     ├── apps/dashboard/keys.ts
     ├── apps/www/keys.ts
     ├── apps/public-api/keys.ts
     ├── apps/public-mcp/keys.ts
     ├── apps/workers/keys.ts
     └── apps/email-preview/keys.ts
```

Each unit's runtime code calls its own `keys()` at module init or first use — validate script proves the template parses; runtime uses developer `.env` / platform env.

---

## Dependencies

| Spec | Relationship |
|------|--------------|
| [CI workflows](./2026-05-23-ci-workflows-design.md) | Depends on this spec — CI runs `pnpm validate:env` |
| [test-utils](./2026-05-23-test-utils-design.md) | Independent |
| [Observability Sentry](./2026-05-23-observability-sentry-design.md) | Independent — Sentry `keys.ts` is out of critical-path v1 scope |

---

## Critical Tests

- `scripts/validate-env.test.ts`: passes when `.env.example` is valid; fails with clear error when a required field is removed from the example file.
- `packages/database/keys.test.ts`: rejects missing or malformed `DATABASE_URL`.
- `packages/auth/keys.test.ts`: OAuth vars optional when unset; rejects malformed `BETTER_AUTH_URL`.
- `packages/billing/keys.test.ts`: accepts placeholder Stripe keys from `.env.example` shape; rejects empty `STRIPE_SECRET_KEY` if marked required.

List colocated paths only. Favor fast unit tests.

---

## Verification

- `pnpm validate:env` — exit 0 with current `.env.example`
- `pnpm type-check`
- `pnpm test -- scripts/validate-env.test.ts packages/database/keys.test.ts packages/auth/keys.test.ts`

---

## Follow-ups (not v1)

- ESLint `no-restricted-syntax` for `process.env` outside `keys.ts` in critical-path units
- Migrate leaf packages (`email`, `ai`, `observability`) to the same convention
- `@t3-oss/env-nextjs` for Next.js client/server split if the single-pattern approach becomes limiting
