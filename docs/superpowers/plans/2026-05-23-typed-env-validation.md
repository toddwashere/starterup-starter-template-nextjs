# Typed Env Validation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Standardize Zod `keys.ts` across critical-path apps and packages, add `pnpm validate:env` that validates `.env.example`, and migrate direct `process.env` reads in those units.

**Architecture:** Each unit exposes `keys.ts` at its root (matching `packages/email` and `packages/worker-queue`). A root `scripts/validate-env.ts` loads `.env.example` into `process.env`, calls every registered `keys()`, and exits non-zero on Zod failures. Runtime code reads env only through `keys()`.

**Tech Stack:** Zod, `dotenv`, `tsx`, Vitest. No `@t3-oss/env-nextjs`.

**Design spec:** [`docs/superpowers/specs/2026-05-23-typed-env-validation-design.md`](../specs/2026-05-23-typed-env-validation-design.md)

**Blocks:** [CI workflows plan](./2026-05-23-ci-workflows.md) — implement this plan first.

---

## File map

| File | Responsibility |
|------|----------------|
| `packages/database/keys.ts` | `DATABASE_URL` schema |
| `packages/database/keys.test.ts` | URL validation tests |
| `packages/database/src/client.ts` | Read URL via `keys()` |
| `packages/auth/keys.ts` | Auth server + client public URL, OAuth vars |
| `packages/auth/keys.test.ts` | Optional OAuth, malformed URL rejection |
| `packages/auth/src/auth.ts` | Use `keys()` for OAuth + invitation base URL |
| `packages/auth/src/auth-client.ts` | Use `keys()` for `NEXT_PUBLIC_BETTER_AUTH_URL` |
| `packages/billing/keys.ts` | Stripe vars |
| `packages/billing/keys.test.ts` | Placeholder key acceptance |
| `packages/billing/src/stripe-client.ts` | Use `keys()` |
| `packages/billing/src/stripe-plugin-options.ts` | Use `keys()` for webhook secret |
| `packages/worker-queue/keys.ts` | Queue adapter vars (align with `.env.example`) |
| `apps/dashboard/keys.ts` | All dashboard `NEXT_PUBLIC_*` URLs |
| `apps/www/keys.ts` | WWW public URLs |
| `apps/public-api/keys.ts` | `PUBLIC_API_PORT` |
| `apps/public-mcp/keys.ts` | `NEXT_PUBLIC_MCP_URL` |
| `apps/workers/keys.ts` | Worker health/poll/max-attempt vars |
| `apps/email-preview/keys.ts` | `EMAIL_PREVIEW_PORT` (optional, default 4004) |
| `scripts/validate-env.ts` | Registry + CLI |
| `scripts/validate-env.test.ts` | Happy path + failure path |
| `scripts/vitest.config.ts` | Root script tests |
| `package.json` (root) | `validate:env` script + devDeps |
| `.ai/conventions/typed-env.md` | Convention doc |
| `.cursor/rules/shared-ai-guidance.mdc` | Trigger for convention |

---

## Critical Tests

- `scripts/validate-env.test.ts`: passes with current `.env.example`; fails when a required var is removed from the example file.
- `packages/database/keys.test.ts`: rejects missing or malformed `DATABASE_URL`.
- `packages/auth/keys.test.ts`: OAuth vars optional when unset; rejects malformed `BETTER_AUTH_URL`.
- `packages/billing/keys.test.ts`: accepts `.env.example`-shaped Stripe placeholders.

---

### Task 1: `@workspace/database` keys

**Files:**
- Create: `packages/database/keys.ts`
- Create: `packages/database/keys.test.ts`
- Modify: `packages/database/package.json`
- Modify: `packages/database/src/client.ts`

- [ ] **Step 1: Add `zod` to database package**

In `packages/database/package.json`, add to `dependencies`:

```json
"zod": "^3"
```

Add export:

```json
"./keys": "./keys.ts"
```

Add script:

```json
"test": "vitest run"
```

Add devDependency `"vitest": "^3"` and create `packages/database/vitest.config.ts`:

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node" },
});
```

- [ ] **Step 2: Write failing test**

Create `packages/database/keys.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { keys } from "./keys";

describe("database keys", () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("parses a valid postgres URL", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/starter_dev";
    expect(keys().DATABASE_URL).toContain("starter_dev");
  });

  it("rejects a missing DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => keys()).toThrow();
  });

  it("rejects a malformed DATABASE_URL", () => {
    process.env.DATABASE_URL = "not-a-url";
    expect(() => keys()).toThrow();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @workspace/database test`
Expected: FAIL — `keys` not defined

- [ ] **Step 4: Implement `keys.ts`**

Create `packages/database/keys.ts`:

```typescript
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .url("DATABASE_URL must be a valid URL"),
});

export function keys() {
  return schema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
  });
}
```

- [ ] **Step 5: Migrate `client.ts`**

Replace the URL read in `packages/database/src/client.ts`:

```typescript
import { keys } from "../keys";

function createPrismaClient(): PrismaClient {
  const { DATABASE_URL } = keys();
  const adapter = new PrismaPg(DATABASE_URL);
  return new PrismaClient({ adapter });
}
```

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @workspace/database test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add packages/database/
git commit -m "feat(database): add typed env keys for DATABASE_URL"
```

---

### Task 2: `@workspace/auth` keys

**Files:**
- Create: `packages/auth/keys.ts`
- Create: `packages/auth/keys.test.ts`
- Modify: `packages/auth/package.json`
- Modify: `packages/auth/src/auth.ts`
- Modify: `packages/auth/src/auth-client.ts`

- [ ] **Step 1: Add `zod` export and test script**

In `packages/auth/package.json`, add:

```json
"zod": "^3",
"./keys": "./keys.ts"
```

(`zod` in `dependencies`; `"test": "vitest run"` already exists.)

- [ ] **Step 2: Write failing tests**

Create `packages/auth/keys.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { keys } from "./keys";

describe("auth keys", () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("defaults BETTER_AUTH_URL for local dev", () => {
    delete process.env.BETTER_AUTH_URL;
    expect(keys().BETTER_AUTH_URL).toBe("http://localhost:4000");
  });

  it("allows OAuth vars to be unset", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_ID;
    expect(keys().GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it("rejects malformed BETTER_AUTH_URL", () => {
    process.env.BETTER_AUTH_URL = "not-a-url";
    expect(() => keys()).toThrow();
  });
});
```

- [ ] **Step 3: Run test — expect FAIL**

Run: `pnpm --filter @workspace/auth test keys.test.ts`

- [ ] **Step 4: Implement `keys.ts`**

Create `packages/auth/keys.ts`:

```typescript
import { z } from "zod";

const schema = z.object({
  BETTER_AUTH_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_BETTER_AUTH_URL: z
    .string()
    .url()
    .default("http://localhost:4000"),
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_TENANT_ID: z.string().default("common"),
});

export function keys() {
  return schema.parse({
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    NEXT_PUBLIC_BETTER_AUTH_URL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
  });
}
```

Note: `NEXT_PUBLIC_BETTER_AUTH_URL` lives here because `auth-client.ts` ships from this package.

- [ ] **Step 5: Migrate `auth.ts`**

At top of `packages/auth/src/auth.ts`:

```typescript
import { keys as authKeys } from "../keys";
```

Replace social provider block:

```typescript
socialProviders: {
  ...(authKeys().GOOGLE_CLIENT_ID && {
    google: {
      clientId: authKeys().GOOGLE_CLIENT_ID,
      clientSecret: authKeys().GOOGLE_CLIENT_SECRET!,
    },
  }),
  ...(authKeys().MICROSOFT_CLIENT_ID && {
    microsoft: {
      clientId: authKeys().MICROSOFT_CLIENT_ID,
      clientSecret: authKeys().MICROSOFT_CLIENT_SECRET!,
      tenantId: authKeys().MICROSOFT_TENANT_ID,
    },
  }),
},
```

Replace invitation email base URL:

```typescript
const { BETTER_AUTH_URL } = authKeys();
await sendInvitationEmail({
  // ...
  acceptUrl: `${BETTER_AUTH_URL}/accept-invitation/${data.id}`,
});
```

- [ ] **Step 6: Migrate `auth-client.ts`**

```typescript
import { keys as authKeys } from "../keys";

export const authClient = createAuthClient({
  baseURL: authKeys().NEXT_PUBLIC_BETTER_AUTH_URL,
  // ...
});
```

- [ ] **Step 7: Run auth tests**

Run: `pnpm --filter @workspace/auth test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add packages/auth/
git commit -m "feat(auth): add typed env keys and migrate auth config"
```

---

### Task 3: `@workspace/billing` keys

**Files:**
- Create: `packages/billing/keys.ts`
- Create: `packages/billing/keys.test.ts`
- Modify: `packages/billing/package.json`
- Modify: `packages/billing/src/stripe-client.ts`
- Modify: `packages/billing/src/stripe-plugin-options.ts`

- [ ] **Step 1: Write failing test**

Create `packages/billing/keys.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { keys } from "./keys";

describe("billing keys", () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("accepts placeholder Stripe keys from .env.example shape", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_xxxxxxxx";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_xxxxxxxx";
    expect(keys().STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  });

  it("allows optional STRIPE_PRICE_* overrides to be unset", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_xxxxxxxx";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_xxxxxxxx";
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
    expect(keys().STRIPE_PRICE_PRO_MONTHLY).toBeUndefined();
  });
});
```

Add `"./keys": "./keys.ts"` to `packages/billing/package.json` exports.

- [ ] **Step 2: Implement `keys.ts`**

```typescript
import { z } from "zod";

const schema = z.object({
  STRIPE_SECRET_KEY: z.string().min(1, "STRIPE_SECRET_KEY is required"),
  STRIPE_WEBHOOK_SECRET: z.string().min(1, "STRIPE_WEBHOOK_SECRET is required"),
  STRIPE_PRICE_PRO_MONTHLY: z.string().optional(),
  STRIPE_PRICE_PRO_ANNUAL: z.string().optional(),
  STRIPE_PRICE_TEAM_MONTHLY: z.string().optional(),
});

export function keys() {
  return schema.parse({
    STRIPE_SECRET_KEY: process.env.STRIPE_SECRET_KEY,
    STRIPE_WEBHOOK_SECRET: process.env.STRIPE_WEBHOOK_SECRET,
    STRIPE_PRICE_PRO_MONTHLY: process.env.STRIPE_PRICE_PRO_MONTHLY,
    STRIPE_PRICE_PRO_ANNUAL: process.env.STRIPE_PRICE_PRO_ANNUAL,
    STRIPE_PRICE_TEAM_MONTHLY: process.env.STRIPE_PRICE_TEAM_MONTHLY,
  });
}
```

- [ ] **Step 3: Migrate stripe files**

`stripe-client.ts`:

```typescript
import { keys } from "../keys";

export function getStripeClient(): Stripe {
  if (!client) {
    const { STRIPE_SECRET_KEY } = keys();
    client = new Stripe(STRIPE_SECRET_KEY);
  }
  return client;
}
```

`stripe-plugin-options.ts`:

```typescript
import { keys } from "../keys";

export function stripePluginOptions(stripeClient: Stripe) {
  return {
  stripeClient,
  stripeWebhookSecret: keys().STRIPE_WEBHOOK_SECRET,
  // ...
  };
}
```

- [ ] **Step 4: Run billing tests**

Run: `pnpm --filter @workspace/billing test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/billing/
git commit -m "feat(billing): add typed env keys for Stripe"
```

---

### Task 4: App-level `keys.ts` files

**Files:**
- Create: `apps/dashboard/keys.ts`
- Create: `apps/www/keys.ts`
- Create: `apps/public-api/keys.ts`
- Create: `apps/public-mcp/keys.ts`
- Create: `apps/workers/keys.ts`
- Create: `apps/email-preview/keys.ts`
- Modify: each app's `package.json` exports (where applicable)
- Modify: `apps/dashboard/features/api-keys/ui/api-key-connect-snippets.tsx`
- Modify: `apps/dashboard/app/api/clear-session/route.ts`
- Modify: `apps/public-api/src/index.ts`
- Modify: `apps/workers/src/index.ts`

- [ ] **Step 1: `apps/dashboard/keys.ts`**

```typescript
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_BETTER_AUTH_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_DASHBOARD_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_WWW_URL: z.string().url().default("http://localhost:4001"),
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:4002"),
  NEXT_PUBLIC_MCP_URL: z.string().url().default("http://localhost:4003"),
  BETTER_AUTH_URL: z.string().url().default("http://localhost:4000"),
});

export function keys() {
  return schema.parse({
    NEXT_PUBLIC_BETTER_AUTH_URL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
    NEXT_PUBLIC_DASHBOARD_URL: process.env.NEXT_PUBLIC_DASHBOARD_URL,
    NEXT_PUBLIC_WWW_URL: process.env.NEXT_PUBLIC_WWW_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_MCP_URL: process.env.NEXT_PUBLIC_MCP_URL,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
  });
}
```

Add `"./keys": "./keys.ts"` to `apps/dashboard/package.json` exports if not present; add `"zod": "^3"` to dependencies.

Migrate `api-key-connect-snippets.tsx`:

```typescript
import { keys } from "../../../keys";
const PUBLIC_API_URL = keys().NEXT_PUBLIC_API_URL;
```

Migrate `clear-session/route.ts`:

```typescript
import { keys } from "../../../keys";
return NextResponse.redirect(new URL("/sign-in", keys().BETTER_AUTH_URL));
```

- [ ] **Step 2: `apps/www/keys.ts`**

```typescript
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_DASHBOARD_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_WWW_URL: z.string().url().default("http://localhost:4001"),
});

export function keys() {
  return schema.parse({
    NEXT_PUBLIC_DASHBOARD_URL: process.env.NEXT_PUBLIC_DASHBOARD_URL,
    NEXT_PUBLIC_WWW_URL: process.env.NEXT_PUBLIC_WWW_URL,
  });
}
```

- [ ] **Step 3: `apps/public-api/keys.ts` + migrate index**

```typescript
import { z } from "zod";

const schema = z.object({
  PUBLIC_API_PORT: z.coerce.number().int().positive().default(4002),
});

export function keys() {
  return schema.parse({
    PUBLIC_API_PORT: process.env.PUBLIC_API_PORT,
  });
}
```

`apps/public-api/src/index.ts`:

```typescript
import { keys } from "../keys";
const port = keys().PUBLIC_API_PORT;
```

- [ ] **Step 4: `apps/public-mcp/keys.ts`**

```typescript
import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_MCP_URL: z
    .string()
    .url()
    .default("http://localhost:4003")
    .transform((v) => v.replace(/\/$/, "")),
});

export function keys() {
  return schema.parse({
    NEXT_PUBLIC_MCP_URL: process.env.NEXT_PUBLIC_MCP_URL,
  });
}
```

Keep `@workspace/common/env/public-mcp` for runtime; validate script registers `apps/public-mcp/keys` separately. Optional follow-up: unify common helper with app keys.

- [ ] **Step 5: Extend `packages/worker-queue/keys.ts`**

Add worker env vars to worker app keys (not worker-queue package):

`apps/workers/keys.ts`:

```typescript
import { z } from "zod";

const schema = z.object({
  WORKER_HEALTH_PORT: z.coerce.number().int().positive().default(4300),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().positive().default(1000),
  WORKER_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
});

export function keys() {
  return schema.parse({
    WORKER_HEALTH_PORT: process.env.WORKER_HEALTH_PORT,
    WORKER_POLL_INTERVAL_MS: process.env.WORKER_POLL_INTERVAL_MS,
    WORKER_MAX_ATTEMPTS: process.env.WORKER_MAX_ATTEMPTS,
  });
}
```

Migrate `apps/workers/src/index.ts`:

```typescript
import { keys as workerKeys } from "../keys";
import { keys as queueKeys } from "@workspace/worker-queue/keys";

const { WORKER_HEALTH_PORT, WORKER_MAX_ATTEMPTS, WORKER_POLL_INTERVAL_MS } =
  workerKeys();
const config: ConsumerConfig = {
  queue: queueKeys().PGMQ_QUEUE_NAME,
  maxAttempts: WORKER_MAX_ATTEMPTS,
  pollIntervalMs: WORKER_POLL_INTERVAL_MS,
};
const healthServer = startHealthServer(WORKER_HEALTH_PORT);
```

- [ ] **Step 6: `apps/email-preview/keys.ts`**

```typescript
import { z } from "zod";

const schema = z.object({
  EMAIL_PREVIEW_PORT: z.coerce.number().int().positive().default(4004),
});

export function keys() {
  return schema.parse({
    EMAIL_PREVIEW_PORT: process.env.EMAIL_PREVIEW_PORT,
  });
}
```

(No runtime migration required — port is in package.json script today; keys exists for validate registry only.)

- [ ] **Step 7: Type-check affected apps**

Run: `pnpm type-check`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add apps/
git commit -m "feat(apps): add typed env keys for critical-path apps"
```

---

### Task 5: Root `validate:env` script

**Files:**
- Create: `scripts/validate-env.ts`
- Create: `scripts/validate-env.test.ts`
- Create: `scripts/vitest.config.ts`
- Modify: `package.json` (root)

- [ ] **Step 1: Add root devDependencies**

In root `package.json`:

```json
"scripts": {
  "validate:env": "tsx scripts/validate-env.ts",
  "test:scripts": "vitest run --config scripts/vitest.config.ts"
},
"devDependencies": {
  "dotenv": "^16",
  "tsx": "^4",
  "vitest": "^3",
  "zod": "^3"
}
```

Run: `pnpm install`

- [ ] **Step 2: Write failing validate-env test**

Create `scripts/validate-env.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

describe("validate-env CLI", () => {
  it("passes against the committed .env.example", () => {
    expect(() =>
      execSync("pnpm validate:env", { cwd: root, stdio: "pipe" }),
    ).not.toThrow();
  });
});
```

- [ ] **Step 3: Implement `scripts/validate-env.ts`**

```typescript
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

config({ path: path.join(root, ".env.example"), override: true });

type Validator = { name: string; validate: () => Promise<unknown> };

const validators: Validator[] = [
  { name: "@workspace/database", validate: async () => (await import("@workspace/database/keys")).keys() },
  { name: "@workspace/auth", validate: async () => (await import("@workspace/auth/keys")).keys() },
  { name: "@workspace/billing", validate: async () => (await import("@workspace/billing/keys")).keys() },
  { name: "@workspace/worker-queue", validate: async () => (await import("@workspace/worker-queue/keys")).keys() },
  { name: "apps/dashboard", validate: async () => (await import("../apps/dashboard/keys.ts")).keys() },
  { name: "apps/www", validate: async () => (await import("../apps/www/keys.ts")).keys() },
  { name: "apps/public-api", validate: async () => (await import("../apps/public-api/keys.ts")).keys() },
  { name: "apps/public-mcp", validate: async () => (await import("../apps/public-mcp/keys.ts")).keys() },
  { name: "apps/workers", validate: async () => (await import("../apps/workers/keys.ts")).keys() },
  { name: "apps/email-preview", validate: async () => (await import("../apps/email-preview/keys.ts")).keys() },
];

let failed = false;

for (const { name, validate } of validators) {
  try {
    await validate();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

process.exit(failed ? 1 : 0);
```

Add root `package.json` workspace imports or use relative paths as shown. If package imports fail under `tsx`, add a root `tsconfig.scripts.json` with path references to workspace packages.

- [ ] **Step 4: Create `scripts/vitest.config.ts`**

```typescript
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: { environment: "node", include: ["scripts/**/*.test.ts"] },
});
```

- [ ] **Step 5: Run validate:env**

Run: `pnpm validate:env`
Expected: all modules print `✓`, exit 0

Run: `pnpm test:scripts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add scripts/ package.json pnpm-lock.yaml
git commit -m "feat: add pnpm validate:env for .env.example parity"
```

---

### Task 6: Convention doc + `.env.example` audit

**Files:**
- Create: `.ai/conventions/typed-env.md`
- Modify: `.cursor/rules/shared-ai-guidance.mdc`
- Modify: `.env.example` (only if gaps found)

- [ ] **Step 1: Write convention**

Create `.ai/conventions/typed-env.md` summarizing: `keys.ts` per package/app, validate:env, critical-path scope, update `.env.example` with schema changes.

- [ ] **Step 2: Register trigger**

Add to `shared-ai-guidance.mdc`:

```markdown
When adding or changing environment variables in critical-path apps or packages (auth, database, billing, worker-queue, dashboard, www, public-api, public-mcp, workers), read `.ai/conventions/typed-env.md` and update both `keys.ts` and `.env.example`.
```

- [ ] **Step 3: Audit `.env.example`**

Verify every field in all `keys.ts` schemas appears in `.env.example`. Add missing entries (e.g. `PUBLIC_API_PORT`, `EMAIL_PREVIEW_PORT` if added to schemas).

- [ ] **Step 4: Final verification**

Run:

```bash
pnpm validate:env
pnpm type-check
pnpm test
```

Expected: all pass

- [ ] **Step 5: Commit**

```bash
git add .ai/ .cursor/ .env.example
git commit -m "docs: add typed env convention and sync .env.example"
```

---

## Verification checklist

- [ ] `pnpm validate:env` exits 0 on clean checkout with only `.env.example`
- [ ] Removing `DATABASE_URL` from `.env.example` causes `validate:env` to fail
- [ ] No raw `process.env` in migrated critical-path files (grep spot-check)
- [ ] CI plan can call `pnpm validate:env` safely
