# Mobile Public API (OAuth + User Routes) Implementation Plan

> **Status (2026-05-29):** **Complete.** Foundation shipped and verified (`pnpm type-check`, `@workspace/auth`, `@apps/public-api`, `@apps/public-mcp` tests pass). Follow-up: [`2026-05-29-mobile-auth-public-api-phase-0.md`](../2026-05-29-mobile-auth-public-api-phase-0.md) (registration, scope enforcement, client-held org, Ignite polish). Note: `/v1/me` still returns `activeOrganizationId` until Phase 0 Task 2 removes it.

> **For agentic workers:** Do **not** execute this plan — it is archived. Use the Phase 0 plan above.

> **Original worker note:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Extend `apps/public-api` so mobile clients (Expo/RN, Flutter, native) authenticate with OAuth Bearer tokens and call user-level routes (`GET /v1/me`, `GET /v1/organizations`) while preserving api-key-only `GET /v1/account` and laying org-scoped middleware for future `/v1/orgs/{orgId}/…` resources.

**Architecture:** Extract OAuth JWT verification into `packages/auth` (shared with `public-mcp`), add org-membership helpers in `packages/auth`, refactor `public-api` to tiered routers (user / api-key account / org-prefixed), and document mobile OAuth client setup. No BFF; one global auth + API host.

**Tech Stack:** Better Auth OAuth Provider (`@better-auth/oauth-provider`), Hono, `@hono/zod-openapi`, Vitest, Prisma (via `@workspace/auth` / `@workspace/database`), `@workspace/common` env helpers.

**Design spec:** [`docs/superpowers/specs/2026-05-25-mobile-public-api-design.md`](../../specs/2026-05-25-mobile-public-api-design.md)

---

## File Structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `packages/auth/src/oauth/verify-access-token.ts` | Verify OAuth Bearer JWT; shared payload shape |
| Create | `packages/auth/src/oauth/verify-access-token.test.ts` | JWT verification behavior |
| Create | `packages/auth/src/public-api/types.ts` | `PublicApiAuthContext` union |
| Create | `packages/auth/src/public-api/org-membership.ts` | List orgs for user; assert membership + role |
| Create | `packages/auth/src/public-api/org-membership.test.ts` | Membership boundaries |
| Create | `packages/auth/src/public-api/user-profile.ts` | Load user + nullable `activeOrganizationId` for `/v1/me` |
| Create | `packages/auth/src/public-api/user-profile.test.ts` | Profile loader |
| Create | `packages/auth/src/public-api/index.ts` | Barrel export |
| Modify | `packages/auth/package.json` | Exports: `./oauth/verify-access-token`, `./public-api` |
| Modify | `apps/public-mcp/src/middleware/mcp-auth.ts` | Delegate OAuth verify to shared helper (DRY) |
| Modify | `apps/public-api/package.json` | Add `@better-auth/oauth-provider` |
| Modify | `apps/public-api/src/lib/context.ts` | `authContext` variable + getters |
| Create | `apps/public-api/src/middleware/resolve-auth.ts` | `x-api-key` OR Bearer OAuth |
| Create | `apps/public-api/src/middleware/resolve-auth.test.ts` | Dual auth + failures |
| Create | `apps/public-api/src/middleware/require-api-key.ts` | Reject Bearer-only on account routes |
| Create | `apps/public-api/src/middleware/org-context.ts` | Path param `orgId` + membership check |
| Create | `apps/public-api/src/middleware/org-context.test.ts` | 400/403/member paths |
| Modify | `apps/public-api/src/middleware/api-key-auth.ts` | Thin wrapper or superseded by `resolve-auth` |
| Modify | `apps/public-api/src/routes/v1/index.ts` | Mount tiered sub-routers |
| Create | `apps/public-api/src/routes/v1/user.ts` | `me`, `organizations` |
| Create | `apps/public-api/src/routes/v1/user.test.ts` | User route tests |
| Create | `apps/public-api/src/routes/v1/org.ts` | `GET /v1/orgs/{orgId}/ping` stub for org middleware |
| Create | `apps/public-api/src/routes/v1/org.test.ts` | Org ping + auth |
| Modify | `apps/public-api/src/routes/v1/account.ts` | Api-key security only in OpenAPI |
| Modify | `apps/public-api/src/routes/v1/account.test.ts` | Bearer rejected on `/v1/account` |
| Modify | `apps/public-api/src/routes/docs.ts` | Register `bearerAuth` scheme |
| Create | `packages/common/src/env/public-api.ts` | `getPublicApiUrl()` from `NEXT_PUBLIC_API_URL` |
| Create | `packages/common/src/env/public-api.test.ts` | Env parse tests |
| Modify | `packages/common/package.json` | Export `./env/public-api` |
| Modify | `.env.example` | `NEXT_PUBLIC_API_URL` if missing |
| Create | `docs/mobile-clients.md` | OAuth client registration, PKCE, env vars (no mobile repo code) |

---

## Critical Tests

| File | Behavior |
|------|----------|
| `packages/auth/src/oauth/verify-access-token.test.ts` | Valid JWT returns `userId` + scopes; invalid/expired returns `null` |
| `packages/auth/src/public-api/org-membership.test.ts` | Member passes; non-member throws/403 path; list returns only user's orgs |
| `apps/public-api/src/middleware/resolve-auth.test.ts` | `x-api-key` → api-key context; Bearer → oauth context; neither → 401 |
| `apps/public-api/src/middleware/org-context.test.ts` | Missing `orgId` → 400; non-member → 403; member proceeds |
| `apps/public-api/src/routes/v1/user.test.ts` | OAuth `me` returns user id + nullable `activeOrganizationId`; no secrets |
| `apps/public-api/src/routes/v1/user.test.ts` | `organizations` empty vs populated lists |
| `apps/public-api/src/routes/v1/account.test.ts` | Api-key unchanged; request with only Bearer → 401 on `/v1/account` |
| `apps/public-api/src/routes/v1/org.test.ts` | OAuth member can `ping` org; non-member 403 |

---

## Task 1: Shared OAuth access-token verification

**Files:**

- Create: `packages/auth/src/oauth/verify-access-token.ts`
- Create: `packages/auth/src/oauth/verify-access-token.test.ts`
- Modify: `packages/auth/package.json`

- [x] **Step 1: Write failing test**

```typescript
// packages/auth/src/oauth/verify-access-token.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVerify = vi.fn();

vi.mock("@better-auth/oauth-provider/resource-client", () => ({
  oauthProviderResourceClient: () => ({
    getActions: () => ({ verifyAccessToken: mockVerify }),
  }),
}));

vi.mock("../auth", () => ({ auth: {} }));

import { verifyOAuthAccessToken } from "./verify-access-token";

describe("verifyOAuthAccessToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns context when JWT is valid", async () => {
    mockVerify.mockResolvedValue({
      sub: "user_1",
      scope: "account:read offline_access",
      client_id: "client_1",
      orgId: "org_1",
    });
    const ctx = await verifyOAuthAccessToken("jwt_token");
    expect(ctx).toEqual({
      userId: "user_1",
      orgId: "org_1",
      scopes: ["account:read", "offline_access"],
      clientId: "client_1",
    });
  });

  it("returns null when verification fails", async () => {
    mockVerify.mockRejectedValue(new Error("invalid"));
    expect(await verifyOAuthAccessToken("bad")).toBeNull();
  });

  it("returns null when sub is missing", async () => {
    mockVerify.mockResolvedValue({ scope: "account:read" });
    expect(await verifyOAuthAccessToken("jwt")).toBeNull();
  });
});
```

- [x] **Step 2: Run test (expect FAIL)**

```bash
pnpm --filter @workspace/auth test -- src/oauth/verify-access-token.test.ts
```

- [x] **Step 3: Implement**

```typescript
// packages/auth/src/oauth/verify-access-token.ts
import { auth } from "../auth";

export type OAuthAccessTokenContext = {
  userId: string;
  orgId: string | null;
  scopes: string[];
  clientId: string | null;
};

export async function verifyOAuthAccessToken(
  token: string,
): Promise<OAuthAccessTokenContext | null> {
  try {
    const { oauthProviderResourceClient } = await import(
      "@better-auth/oauth-provider/resource-client"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = oauthProviderResourceClient(auth as any);
    const verifyFn = client.getActions().verifyAccessToken as (
      t: string,
    ) => Promise<Record<string, unknown>>;
    const payload = await verifyFn(token);
    const sub = payload["sub"];
    if (typeof sub !== "string") return null;
    const scope = payload["scope"];
    const clientId = payload["client_id"] ?? payload["azp"] ?? null;
    const orgId = payload["orgId"] ?? null;
    return {
      userId: sub,
      orgId: typeof orgId === "string" ? orgId : null,
      scopes:
        typeof scope === "string" ? scope.split(" ").filter(Boolean) : [],
      clientId: typeof clientId === "string" ? clientId : null,
    };
  } catch {
    return null;
  }
}
```

- [x] **Step 4: Export in `packages/auth/package.json`**

```json
"./oauth/verify-access-token": "./src/oauth/verify-access-token.ts"
```

- [x] **Step 5: Run test (expect PASS)**

```bash
pnpm --filter @workspace/auth test -- src/oauth/verify-access-token.test.ts
```

- [x] **Step 6: Refactor `apps/public-mcp/src/middleware/mcp-auth.ts`**

Replace inline `resolveOAuthContext` body with:

```typescript
import { verifyOAuthAccessToken } from "@workspace/auth/oauth/verify-access-token";

async function resolveOAuthContext(token: string): Promise<AuthContext | null> {
  const ctx = await verifyOAuthAccessToken(token);
  if (!ctx) return null;
  return {
    kind: "oauth",
    userId: ctx.userId,
    orgId: ctx.orgId,
    scopes: ctx.scopes,
    clientId: ctx.clientId,
  };
}
```

Run: `pnpm --filter @apps/public-mcp test`

- [x] **Step 7: Commit**

```bash
git add packages/auth/src/oauth packages/auth/package.json apps/public-mcp/src/middleware/mcp-auth.ts
git commit -m "feat(auth): share OAuth access token verification for public API"
```

---

## Task 2: Public API auth types and org membership helpers

**Files:**

- Create: `packages/auth/src/public-api/types.ts`
- Create: `packages/auth/src/public-api/org-membership.ts`
- Create: `packages/auth/src/public-api/org-membership.test.ts`
- Create: `packages/auth/src/public-api/user-profile.ts`
- Create: `packages/auth/src/public-api/user-profile.test.ts`
- Create: `packages/auth/src/public-api/index.ts`
- Modify: `packages/auth/package.json`

- [x] **Step 1: Define types**

```typescript
// packages/auth/src/public-api/types.ts
import type { ApiKeyContext } from "../api-keys/verify";

export type PublicApiAuthContext =
  | ({ kind: "oauth" } & {
      userId: string;
      orgId: string | null;
      scopes: string[];
      clientId: string | null;
    })
  | ({ kind: "api-key" } & ApiKeyContext);

export class PublicApiOrgError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "PublicApiOrgError";
  }
}
```

- [x] **Step 2: Write failing org-membership tests**

```typescript
// packages/auth/src/public-api/org-membership.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    member: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@workspace/database";
import {
  assertUserOrgMember,
  listOrganizationsForUser,
  PublicApiOrgError,
} from "./org-membership";

describe("assertUserOrgMember", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns role when member exists", async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ role: "admin" } as never);
    const role = await assertUserOrgMember("user_1", "org_1");
    expect(role).toBe("admin");
  });

  it("throws FORBIDDEN when not a member", async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null);
    await expect(assertUserOrgMember("user_1", "org_2")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("listOrganizationsForUser", () => {
  it("returns mapped org rows", async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      {
        role: "member",
        organization: { id: "org_1", name: "Acme", slug: "acme" },
      },
    ] as never);
    const rows = await listOrganizationsForUser("user_1");
    expect(rows).toEqual([
      { id: "org_1", name: "Acme", slug: "acme", role: "member" },
    ]);
  });
});
```

- [x] **Step 3: Implement org-membership**

```typescript
// packages/auth/src/public-api/org-membership.ts
import { prisma } from "@workspace/database";
import { PublicApiOrgError } from "./types";

export type UserOrganizationSummary = {
  id: string;
  name: string;
  slug: string;
  role: string;
};

export async function assertUserOrgMember(
  userId: string,
  organizationId: string,
): Promise<string> {
  const member = await prisma.member.findFirst({
    where: { userId, organizationId },
    select: { role: true },
  });
  if (!member) {
    throw new PublicApiOrgError("FORBIDDEN", "Not a member of this organization");
  }
  return member.role;
}

export async function listOrganizationsForUser(
  userId: string,
): Promise<UserOrganizationSummary[]> {
  const members = await prisma.member.findMany({
    where: { userId },
    select: {
      role: true,
      organization: { select: { id: true, name: true, slug: true } },
    },
    orderBy: { organization: { name: "asc" } },
  });
  return members.map((m) => ({
    id: m.organization.id,
    name: m.organization.name,
    slug: m.organization.slug,
    role: m.role,
  }));
}
```

- [x] **Step 4: Implement user-profile helper + test**

`getUserProfileForPublicApi(userId)` loads `prisma.user` (`id`, `name`, `email`, `image`) and latest session `activeOrganizationId` via `prisma.session.findFirst({ where: { userId }, orderBy: { updatedAt: "desc" } })`. Test with mocked prisma.

- [x] **Step 5: Barrel + package export**

```json
"./public-api": "./src/public-api/index.ts"
```

- [x] **Step 6: Run auth package tests**

```bash
pnpm --filter @workspace/auth test
```

- [x] **Step 7: Commit**

```bash
git add packages/auth/src/public-api packages/auth/package.json
git commit -m "feat(auth): add public API org membership and user profile helpers"
```

---

## Task 3: `public-api` context and `resolve-auth` middleware

**Files:**

- Modify: `apps/public-api/src/lib/context.ts`
- Create: `apps/public-api/src/middleware/resolve-auth.ts`
- Create: `apps/public-api/src/middleware/resolve-auth.test.ts`
- Modify: `apps/public-api/package.json`

- [x] **Step 1: Add dependency**

```bash
cd apps/public-api && pnpm add @better-auth/oauth-provider@^1.6.11
```

- [x] **Step 2: Update context**

```typescript
// apps/public-api/src/lib/context.ts
import type { Context } from "hono";
import type { PublicApiAuthContext } from "@workspace/auth/public-api";

export type AppEnv = {
  Variables: {
    authContext: PublicApiAuthContext;
    orgId?: string;
    orgRole?: string;
  };
};

export function getAuthContext(c: Context<AppEnv>): PublicApiAuthContext {
  return c.get("authContext");
}
```

Keep `getApiKeyContext` as a narrow helper that throws if `kind !== "api-key"` (update `account.ts` imports).

- [x] **Step 3: Write failing resolve-auth test**

```typescript
// apps/public-api/src/middleware/resolve-auth.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../lib/context";

vi.mock("@workspace/auth/api-keys", () => ({
  verifyApiKey: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

vi.mock("@workspace/auth/oauth/verify-access-token", () => ({
  verifyOAuthAccessToken: vi.fn(),
}));

import { verifyApiKey, ApiKeyError } from "@workspace/auth/api-keys";
import { verifyOAuthAccessToken } from "@workspace/auth/oauth/verify-access-token";
import { resolveAuth } from "./resolve-auth";

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("*", resolveAuth);
  app.get("/probe", (c) => c.json({ kind: c.get("authContext").kind }));
  return app;
}

describe("resolveAuth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets api-key context from x-api-key", async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({
      keyId: "k1",
      orgId: "org_1",
      userId: null,
      ownerType: "organization",
      permissions: {},
    });
    const res = await buildApp().request("/probe", {
      headers: { "x-api-key": "sk_org_x" },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).kind).toBe("api-key");
  });

  it("sets oauth context from Bearer", async () => {
    vi.mocked(verifyOAuthAccessToken).mockResolvedValue({
      userId: "user_1",
      orgId: null,
      scopes: ["account:read"],
      clientId: "c1",
    });
    const res = await buildApp().request("/probe", {
      headers: { authorization: "Bearer jwt" },
    });
    expect((await res.json()).kind).toBe("oauth");
  });

  it("returns 401 when no credentials", async () => {
    const res = await buildApp().request("/probe");
    expect(res.status).toBe(401);
  });
});
```

- [x] **Step 4: Implement `resolve-auth.ts`**

Priority: if `x-api-key` present, verify key (401/429 on `ApiKeyError`). Else if `Authorization: Bearer`, call `verifyOAuthAccessToken`; 401 if null. Else 401 `Missing authentication`. Set `c.set("authContext", …)`.

Do **not** accept session cookies (mobile spec).

- [x] **Step 5: Run tests**

```bash
pnpm --filter @apps/public-api test -- src/middleware/resolve-auth.test.ts
```

- [x] **Step 6: Commit**

```bash
git add apps/public-api/src/lib/context.ts apps/public-api/src/middleware/resolve-auth.ts apps/public-api/src/middleware/resolve-auth.test.ts apps/public-api/package.json
git commit -m "feat(public-api): add dual api-key and OAuth resolve-auth middleware"
```

---

## Task 4: Org-context middleware and stub org route

**Files:**

- Create: `apps/public-api/src/middleware/org-context.ts`
- Create: `apps/public-api/src/middleware/org-context.test.ts`
- Create: `apps/public-api/src/routes/v1/org.ts`
- Create: `apps/public-api/src/routes/v1/org.test.ts`

- [x] **Step 1: Write failing org-context test**

Middleware reads `c.req.param("orgId")`. Requires `authContext.kind === "oauth"` (api-key org routes can use key's `orgId` in a follow-up; for stub, oauth only). Calls `assertUserOrgMember(userId, orgId)`. Sets `orgId` + `orgRole` on context. Missing param → 400; `PublicApiOrgError` → 403.

- [x] **Step 2: Implement org-context + `GET /v1/orgs/{orgId}/ping`**

Returns `{ orgId, role }` with `account:read` scope check: oauth scopes include `account:read` OR api-key has `account:read` when extended later.

- [x] **Step 3: Run tests**

```bash
pnpm --filter @apps/public-api test -- src/middleware/org-context.test.ts src/routes/v1/org.test.ts
```

- [x] **Step 4: Commit**

```bash
git add apps/public-api/src/middleware/org-context.ts apps/public-api/src/middleware/org-context.test.ts apps/public-api/src/routes/v1/org.ts apps/public-api/src/routes/v1/org.test.ts
git commit -m "feat(public-api): org-scoped middleware and ping stub route"
```

---

## Task 5: User routes `GET /v1/me` and `GET /v1/organizations`

**Files:**

- Create: `apps/public-api/src/routes/v1/user.ts`
- Create: `apps/public-api/src/routes/v1/user.test.ts`
- Create: `apps/public-api/src/middleware/require-oauth.ts` (optional: user routes require `kind === "oauth"`)

- [x] **Step 1: Write failing tests**

`me`: oauth context → 200 with `{ id, name, email, image, activeOrganizationId }`; api-key → 403 or 401 per design (user routes for mobile = oauth only — return 403 `FORBIDDEN` with message "OAuth Bearer required").

`organizations`: returns `{ organizations: [...] }` from `listOrganizationsForUser`.

Assert response JSON has no fields matching `token`, `refresh`, `key`.

- [x] **Step 2: Implement routes with OpenAPI**

Register security `bearerAuth` on both routes. Handler:

```typescript
const ctx = getAuthContext(c);
if (ctx.kind !== "oauth") {
  return errorResponse(c, 403, "FORBIDDEN", "OAuth Bearer required");
}
```

`me` calls `getUserProfileForPublicApi(ctx.userId)`.

`organizations` calls `listOrganizationsForUser(ctx.userId)`.

- [x] **Step 3: Run tests PASS**

- [x] **Step 4: Commit**

```bash
git add apps/public-api/src/routes/v1/user.ts apps/public-api/src/routes/v1/user.test.ts apps/public-api/src/middleware/require-oauth.ts
git commit -m "feat(public-api): add /v1/me and /v1/organizations for mobile OAuth"
```

---

## Task 6: Refactor v1 router and protect `/v1/account`

**Files:**

- Modify: `apps/public-api/src/routes/v1/index.ts`
- Modify: `apps/public-api/src/routes/v1/account.ts`
- Modify: `apps/public-api/src/routes/v1/account.test.ts`
- Create: `apps/public-api/src/middleware/require-api-key.ts`

- [x] **Step 1: `require-api-key` middleware**

If `authContext.kind !== "api-key"`, return 401 `API key required`.

- [x] **Step 2: Restructure `createV1Router`**

```typescript
export function createV1Router(): OpenAPIHono<AppEnv> {
  const v1 = new OpenAPIHono<AppEnv>();

  const user = new OpenAPIHono<AppEnv>();
  user.use("/*", resolveAuth);
  registerUserRoutes(user);

  const account = new OpenAPIHono<AppEnv>();
  account.use("/*", resolveAuth, requireApiKey);
  registerAccountRoute(account);

  const orgs = new OpenAPIHono<AppEnv>();
  orgs.use("/*", resolveAuth);
  registerOrgRoutes(orgs); // mounts /orgs/{orgId}/...

  v1.route("/", user);
  v1.route("/", account);
  v1.route("/", orgs);
  return v1;
}
```

Remove global `apiKeyAuth` + `orgScope` from old `index.ts`.

- [x] **Step 3: Update account.test.ts**

Add case: middleware chain with oauth-only context → 401 on `/v1/account`.

- [x] **Step 4: Run all public-api tests**

```bash
pnpm --filter @apps/public-api test
```

- [x] **Step 5: Commit**

```bash
git add apps/public-api/src/routes/v1 apps/public-api/src/middleware/require-api-key.ts
git commit -m "refactor(public-api): tiered v1 routers for user, account, and org routes"
```

---

## Task 7: OpenAPI security schemes and docs

**Files:**

- Modify: `apps/public-api/src/routes/docs.ts`
- Create: `docs/mobile-clients.md`
- Modify: `.env.example`

- [x] **Step 1: Register Bearer scheme in `registerDocs`**

```typescript
app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
  type: "http",
  scheme: "bearer",
  bearerFormat: "JWT",
});
```

Tag routes: `User`, `Integration`, `Organization`.

- [x] **Step 2: Add `docs/mobile-clients.md`**

Sections:

- Env: `AUTH_BASE_URL` (`BETTER_AUTH_URL`), `API_BASE_URL` (`NEXT_PUBLIC_API_URL`)
- OAuth: register client, redirect URIs per platform, scopes `account:read` + `offline_access`
- Flow: PKCE → Bearer on API; explicit `orgId` on `/v1/orgs/{orgId}/…`; optional `setActive` on auth server
- Do not embed API keys in consumer apps
- Link `/docs` OpenAPI on public-api

- [x] **Step 3: `.env.example`**

```bash
NEXT_PUBLIC_API_URL="http://localhost:4002"
```

- [x] **Step 4: Commit**

```bash
git add apps/public-api/src/routes/docs.ts docs/mobile-clients.md .env.example
git commit -m "docs: mobile client OAuth guide and public API OpenAPI bearer scheme"
```

---

## Task 8: `NEXT_PUBLIC_API_URL` helper in `@workspace/common`

**Files:**

- Create: `packages/common/src/env/public-api.ts`
- Create: `packages/common/src/env/public-api.test.ts`
- Modify: `packages/common/package.json`

Mirror `public-mcp.ts` pattern with `NEXT_PUBLIC_API_URL`, default `http://localhost:4002`, `getPublicApiUrl()`, `getPublicApiListenPort()` (optional, for symmetry).

- [x] **Step 1: Tests + implementation**

- [x] **Step 2: Use in dashboard api-key snippets if they hardcode API URL** (grep `localhost:4002` / `4100` and align)

- [x] **Step 3: Commit**

```bash
git add packages/common/src/env/public-api.ts packages/common/package.json
git commit -m "feat(common): add validated NEXT_PUBLIC_API_URL helper"
```

---

## Task 9: Final verification

- [x] **Step 1: Type-check**

```bash
pnpm type-check
```

- [x] **Step 2: Lint**

```bash
pnpm lint
```

- [x] **Step 3: Targeted tests**

```bash
pnpm --filter @workspace/auth test
pnpm --filter @apps/public-api test
pnpm --filter @apps/public-mcp test
```

- [x] **Step 4: Manual smoke (local)**

1. Start dashboard (`pnpm dev` or filter) on `:4000`.
2. Start `public-api` on `:4002`.
3. Create OAuth client / use dynamic registration per `docs/mobile-clients.md`.
4. Obtain access token; `curl -H "Authorization: Bearer $TOKEN" http://localhost:4002/v1/me`.
5. `curl -H "x-api-key: sk_org_..." http://localhost:4002/v1/account` still works.

- [x] **Step 5: Commit any fixups**

---

## Spec Coverage (self-review)

| Spec requirement | Task |
|------------------|------|
| OAuth Bearer on public-api | Task 1, 3 |
| Dual auth api-key + Bearer | Task 3, 6 |
| `GET /v1/me`, `GET /v1/organizations` | Task 5 |
| Api-key-only `/v1/account` | Task 6 |
| Explicit org on org routes | Task 4 |
| No session cookie mobile auth | Task 3 (omit cookie path) |
| OpenAPI bearer + apiKey | Task 7 |
| Shared auth host | Task 7 docs |
| Critical tests listed | Tasks 1–6 |
| Defer domain contacts routes | Not in plan (org ping stub only) |
| DRY with MCP OAuth verify | Task 1 |

---

## Out of Scope (follow-up plans)

- `GET /v1/orgs/{orgId}/contacts` and other domain resources
- Composite/batch routes
- Push device registration
- CORS for web-based mobile auth flows
- OAuth scope expansion beyond `account:read` / `offline_access`

---

## Completion (2026-05-29)

All tasks implemented. Minor doc drift (`mobile-clients.md` org model, optional `Integration` OpenAPI tag on `/v1/account`) deferred to Phase 0.
