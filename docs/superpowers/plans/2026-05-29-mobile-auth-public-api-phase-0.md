# Phase 0: Mobile Auth — Public API Support

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `apps/public-api` a complete, documented, and test-covered HTTP surface for mobile clients built on the [Infinite Red Ignite](https://github.com/infinitered/ignite) boilerplate (apisauce, MMKV, secure token storage) — registration, post-login profile/org routes, and org-scoped route readiness. Mobile authenticates via PKCE on the auth server, then calls public-api with OAuth Bearer tokens.

**Out of scope for this plan (auth server / mobile repo):**

- Login UI and **OAuth authorize/token/refresh** flows (Better Auth on `BETTER_AUTH_URL`, PKCE in mobile repo).
- Domain-specific org routes (contacts, visits, etc.) beyond the org middleware smoke route.
- Embedding API keys in mobile binaries.
- Server-side “active organization” — mobile never sets or reads active org from public-api; see [Org model](#org-model-mobile).

**Prerequisite plans:** Foundation from [`2026-05-25-mobile-public-api.md`](./done/2026-05-25-mobile-public-api.md) (archived complete). Execute **this** plan only.

**Prerequisite spec:** [`docs/superpowers/specs/2026-05-25-mobile-public-api-design.md`](../specs/2026-05-25-mobile-public-api-design.md) — org scoping and dual-auth model; Phase 0 overrides “active org on server” and adds registration on public-api.

---

## Auth boundary (read first)

Mobile uses **two HTTP origins**:

| Origin | Responsibility | Example |
|--------|----------------|---------|
| **Auth server** (`BETTER_AUTH_URL`, port 4000) | OAuth authorize, token, refresh | PKCE → access + refresh tokens |
| **Public API** (`PUBLIC_API`, port 4002) | Registration + domain data **after** authentication | `POST /v1/auth/register`, `GET /v1/me`, org-scoped routes |

```text
Mobile app (Ignite: apisauce → API_BASE_URL, expo-auth-session → AUTH_BASE_URL)
  │
  ├── POST /v1/auth/register          (public-api, no auth)
  │
  ├── PKCE sign-in / refresh          (auth server)
  │     └── access_token
  │
  └── Public API (Authorization: Bearer …)
        ├── GET /v1/me
        ├── GET /v1/organizations
        └── GET /v1/orgs/{orgId}/ping   ← pattern for future org routes
```

**Login and token endpoints stay on the auth server.** Phase 0 adds **registration** on public-api only (aligned with sibling mobile plan).

---

## Org model (mobile)

**Decisions (locked for Phase 0):**

1. **Explicit `orgId` on every org-scoped call** — path prefix `/v1/orgs/{orgId}/…` is required; no header-only org context for mobile.
2. **No server-side active org in public-api** — do not expose, read, or write `activeOrganizationId` on public-api routes. The mobile client stores the selected `orgId` locally (Ignite: MMKV via app state) and passes it on each org-scoped request.
3. **No `PATCH /v1/me/active-organization`** — removed; no synthetic Better Auth `Session` rows for org sync.

Org membership is enforced per request by `org-context` middleware from the path param, not from session state.

---

## Ignite compatibility notes

Target mobile stack: [Infinite Red Ignite](https://github.com/infinitered/ignite) (Expo/RN, apisauce, MMKV).

| Concern | public-api contract |
|---------|---------------------|
| HTTP client | apisauce `Api` with `baseURL: API_BASE_URL` |
| Errors | Stable JSON `{ error: { code, message } }` — map `401` → re-auth, `403` → permission UI, `429` → backoff |
| Auth header | `Authorization: Bearer <access_token>` on authenticated routes |
| Org context | Client-held `orgId`; never infer from `/v1/me` |
| Client types | Generate from `GET {API_BASE_URL}/openapi.json` (OpenAPI Generator, etc.) |
| Config | `AUTH_BASE_URL` → auth server; `API_BASE_URL` → public-api (see `docs/mobile-clients.md`) |

---

## Current state (baseline)

The [2026-05-25 mobile public API plan](./done/2026-05-25-mobile-public-api.md) (archived complete) shipped most of the foundation:

| Item | Status |
|------|--------|
| `verifyOAuthAccessToken` in `@workspace/auth` | Done |
| `resolve-auth` middleware (api-key OR Bearer) | Done |
| `GET /v1/me` | Done — **remove `activeOrganizationId` from response (Phase 0)** |
| `GET /v1/organizations` | Done |
| `GET /v1/account` (api-key only) | Done |
| `GET /v1/orgs/{orgId}/ping` + `org-context` middleware | Done |
| Unit tests for middleware + routes | Done |
| [`docs/mobile-clients.md`](../../mobile-clients.md) | Done — update for Phase 0 |

**Known gaps for mobile Phase 0:**

1. No **OAuth scope enforcement** middleware (routes assume any valid Bearer).
2. `GET /v1/me` still returns **`activeOrganizationId`** from dashboard sessions — remove for mobile contract.
3. No **`POST /v1/auth/register`** for mobile sign-up via public-api.
4. OpenAPI lacks **shared error response schemas** and mobile-oriented examples.
5. No **integration smoke** path with a **dev token helper** for local PKCE → public-api calls.
6. Org routes reject api-key auth (OAuth only) — fine for consumer mobile; document explicitly.

---

## Phase 0 deliverables (public-api)

### Routes to ship or verify

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST` | `/v1/auth/register` | None | Email/password sign-up (**new**) |
| `GET` | `/v1/me` | OAuth Bearer | Profile (`id`, `name`, `email`, `image`) — **no active org field** |
| `GET` | `/v1/organizations` | OAuth Bearer | Org picker list |
| `GET` | `/v1/orgs/{orgId}/ping` | OAuth Bearer + member | Org middleware smoke test |
| `GET` | `/v1/account` | `x-api-key` only | Unchanged (not for mobile) |

**Not on public-api:** OAuth authorize/token/refresh, login UI, password reset (future slice if needed).

### OAuth scopes (Phase 0)

| Scope | Routes |
|-------|--------|
| `account:read` | `GET /v1/me`, `GET /v1/organizations`, `GET /v1/orgs/{orgId}/ping` |
| `offline_access` | Refresh tokens (auth server only) |

Additional scopes attach when new org-scoped domain routes land.

---

## File structure

| Action | Path | Responsibility |
|--------|------|----------------|
| Create | `apps/public-api/src/middleware/require-scope.ts` | Enforce OAuth scope on Bearer context |
| Create | `apps/public-api/src/middleware/require-scope.test.ts` | Scope missing → 403 |
| Modify | `apps/public-api/src/routes/v1/index.ts` | Chain `requireScope("account:read")` on user + org routers; mount auth router |
| Create | `apps/public-api/src/routes/v1/auth.ts` | `POST /v1/auth/register` |
| Create | `apps/public-api/src/routes/v1/auth.test.ts` | Register validation + success/error paths |
| Create | `packages/auth/src/public-api/register-user.ts` | Delegate to Better Auth `signUpEmail` |
| Create | `packages/auth/src/public-api/register-user.test.ts` | Sign-up boundaries |
| Modify | `packages/auth/src/public-api/user-profile.ts` | Drop `activeOrganizationId` from public-api profile |
| Modify | `packages/auth/src/public-api/user-profile.test.ts` | Updated profile shape |
| Modify | `packages/auth/src/public-api/index.ts` | Export register helper |
| Modify | `apps/public-api/src/routes/v1/user.ts` | Remove `activeOrganizationId` from OpenAPI + handler |
| Modify | `apps/public-api/src/routes/v1/user.test.ts` | Assert profile shape without active org |
| Create | `packages/auth/src/public-api/openapi-schemas.ts` | Shared `ErrorResponse`, user/org schemas (optional DRY) |
| Modify | `apps/public-api/src/routes/docs.ts` | Register error schema + route examples |
| Create | `apps/public-api/scripts/obtain-dev-access-token.ts` | Local dev: register/sign-in + OAuth token for smoke |
| Create | `apps/public-api/scripts/smoke-mobile-auth.sh` | curl recipe using `$ACCESS_TOKEN` |
| Modify | `apps/public-api/package.json` | `"smoke:token"` script → obtain-dev-access-token |
| Modify | `docs/mobile-clients.md` | Phase 0 routes, org model, Ignite notes, smoke scripts |
| Verify | `.env.example` | Already documents `NEXT_PUBLIC_API_URL`, `BETTER_AUTH_URL` |

---

## Critical tests

| File | Behavior |
|------|----------|
| `apps/public-api/src/middleware/require-scope.test.ts` | Missing `account:read` → 403; api-key bypasses scope check |
| `packages/auth/src/public-api/register-user.test.ts` | Valid input creates user; duplicate email → `PublicApiRegisterError` with `VALIDATION_ERROR` |
| `apps/public-api/src/routes/v1/auth.test.ts` | `POST /v1/auth/register` → 201; duplicate email → 400 + sign-in hint message |
| `packages/auth/src/public-api/user-profile.test.ts` | Profile has no `activeOrganizationId` field |
| `apps/public-api/src/routes/v1/user.test.ts` | `/v1/me` omits active org; oauth-only |
| Existing suite | All prior `org`, `resolve-auth`, `account` tests still pass |

---

## Task 1: OAuth scope middleware

**Files:**

- Create: `apps/public-api/src/middleware/require-scope.ts`
- Create: `apps/public-api/src/middleware/require-scope.test.ts`
- Modify: `apps/public-api/src/routes/v1/index.ts`

- [ ] **Step 1: Implement `requireScope(...scopes: string[])`**

Behavior:

- If `authContext.kind === "oauth"`, require at least one listed scope in `authContext.scopes`.
- If `authContext.kind === "api-key"`, skip (integration keys use permissions, not OAuth scopes).
- On failure: `403` `{ error: { code: "FORBIDDEN", message: "Insufficient scope" } }`.

- [ ] **Step 2: Apply to user and org routers**

In `apps/public-api/src/routes/v1/index.ts`, chain **after** `resolveAuth` and **before** handlers / `orgContext`:

```typescript
user.use("/*", resolveAuth);
user.use("/*", requireScope("account:read"));
registerUserRoutes(user);

orgs.use("/v1/orgs/:orgId/*", resolveAuth);
orgs.use("/v1/orgs/:orgId/*", requireScope("account:read"));
orgs.use("/v1/orgs/:orgId/*", orgContext);
registerOrgRoutes(orgs);
```

- [ ] **Step 3: Tests + full public-api test run**

```bash
pnpm --filter @apps/public-api test
```

---

## Task 2: Drop active org from public-api profile

**Rationale:** Mobile holds `orgId` locally; public-api must not reference server active org.

**Files:**

- Modify: `packages/auth/src/public-api/user-profile.ts`
- Modify: `packages/auth/src/public-api/user-profile.test.ts`
- Modify: `apps/public-api/src/routes/v1/user.ts`
- Modify: `apps/public-api/src/routes/v1/user.test.ts`

- [ ] **Step 1: Remove `activeOrganizationId` from `PublicApiUserProfile` and loader**
- [ ] **Step 2: Update OpenAPI `MeResponseSchema` and tests**
- [ ] **Step 3: Run auth + public-api tests**

---

## Task 3: Registration route

### Duplicate email policy (Phase 0)

**Choice:** Explicit error — matches dashboard behavior with current auth config (`requireEmailVerification: false`).

When Better Auth rejects sign-up because the email already exists, public-api returns:

- **HTTP `400`**
- **`{ error: { code: "VALIDATION_ERROR", message: "An account with this email already exists. Sign in instead." } }`**

Mobile (Ignite) should show inline error + navigate to sign-in. This trades enumeration resistance for clear UX in a starter template.

**Future hardening:** If auth config enables `requireEmailVerification: true`, Better Auth switches to enumeration-safe identical success responses. At that point, update `register-user.ts` to always return `201` with the same body and change mobile copy to generic “check your inbox or sign in” — do not keep the explicit duplicate-email error once auth is enumeration-safe.

**Files:**

- Create: `packages/auth/src/public-api/register-user.ts`
- Create: `packages/auth/src/public-api/register-user.test.ts`
- Modify: `packages/auth/src/public-api/index.ts`
- Create: `apps/public-api/src/routes/v1/auth.ts`
- Create: `apps/public-api/src/routes/v1/auth.test.ts`
- Modify: `apps/public-api/src/routes/v1/index.ts`

- [ ] **Step 1: Domain helper**

Call Better Auth server API (same as dashboard sign-up):

```typescript
// packages/auth/src/public-api/register-user.ts
// registerUserForPublicApi({ name, email, password })
// → auth.api.signUpEmail({ body: { name, email, password } })
// Success: { id, name, email } — no password, no session token.
// Duplicate email (Better Auth APIError): throw PublicApiRegisterError("VALIDATION_ERROR", message above).
// Other validation (weak password, invalid email): same VALIDATION_ERROR pattern with auth message passthrough.
```

- [ ] **Step 2: Route**

```typescript
// POST /v1/auth/register
// Body: { name: string, email: string, password: string }
// Response 201: { user: { id, name, email } }
// Response 400: duplicate email or validation (see policy above)
// No auth required. After success, mobile runs PKCE on auth server.
```

OpenAPI: tag `Auth`; document `201`, `400` with shared `ErrorResponse` schema.

- [ ] **Step 3: Mount unauthenticated auth router in `v1/index.ts`** (no `resolveAuth` on `/v1/auth/register`)

- [ ] **Step 4: Unit + route tests**

  - New user → `201`
  - Same email twice → second call `400` + `VALIDATION_ERROR` + sign-in hint
  - Invalid password length → `400` + `VALIDATION_ERROR`

---

## Task 4: OpenAPI polish for mobile client generation

**Files:**

- Modify: `apps/public-api/src/routes/docs.ts`
- Modify: route files for shared error responses

- [ ] **Step 1: Register reusable error schema**

```typescript
const ErrorResponseSchema = z.object({
  error: z.object({
    code: z.enum([
      "UNAUTHORIZED",
      "FORBIDDEN",
      "RATE_LIMITED",
      "NOT_FOUND",
      "VALIDATION_ERROR",
      "INTERNAL_ERROR",
    ]),
    message: z.string(),
  }),
});
```

- [ ] **Step 2: Attach `401` / `403` / `400` responses to auth, user, and org routes**
- [ ] **Step 3: Verify `/openapi.json` exports `bearerAuth` + tagged `Auth` / `User` / `Organization` routes**
- [ ] **Step 4: Document in `mobile-clients.md`:**

```bash
curl -s "$API_BASE_URL/openapi.json" | head
```

---

## Task 5: Integration smoke + dev token helper

**Files:**

- Create: `apps/public-api/scripts/obtain-dev-access-token.ts`
- Create: `apps/public-api/scripts/smoke-mobile-auth.sh`
- Modify: `apps/public-api/package.json`
- Modify: `docs/mobile-clients.md`

- [ ] **Step 1: Dev token script**

Node script (run via `pnpm --filter @apps/public-api smoke:token`) that:

1. Reads env: `AUTH_BASE_URL`, `API_BASE_URL`, `SMOKE_EMAIL`, `SMOKE_PASSWORD`, `SMOKE_OAUTH_CLIENT_ID`, `SMOKE_OAUTH_REDIRECT_URI` (document defaults for local dev).
2. Optionally registers via `POST /v1/auth/register` if user missing.
3. Performs OAuth PKCE against auth server (or documented dev shortcut from sibling mobile plan) and prints `ACCESS_TOKEN` for shell export.

**Local-only; no secrets committed.**

- [ ] **Step 2: Smoke shell script**

```bash
#!/usr/bin/env bash
set -euo pipefail
API_BASE_URL="${API_BASE_URL:-http://localhost:4002}"
: "${ACCESS_TOKEN:?Run: eval \"\$(pnpm --filter @apps/public-api smoke:token --print-env)\"}"

curl -sf -H "Authorization: Bearer $ACCESS_TOKEN" "$API_BASE_URL/v1/me" | jq .
curl -sf -H "Authorization: Bearer $ACCESS_TOKEN" "$API_BASE_URL/v1/organizations" | jq .
# After picking org locally:
# curl -sf -H "Authorization: Bearer $ACCESS_TOKEN" "$API_BASE_URL/v1/orgs/$ORG_ID/ping" | jq .
```

- [ ] **Step 3: Document one-liner in `mobile-clients.md`**
- [ ] **Step 4: `chmod +x apps/public-api/scripts/smoke-mobile-auth.sh`**

---

## Task 6: Documentation & Phase 0 definition of done

**Files:**

- Modify: `docs/mobile-clients.md`

- [ ] **Update mobile-clients.md** with:

  - Phase 0 route table (`POST /v1/auth/register`, `/v1/me` without active org)
  - Org model: client-held `orgId`; explicit path on all `/v1/orgs/{orgId}/…` calls
  - No server active org on public-api; no `organization.setActive` required for API calls
  - Ignite/apisauce error mapping
  - `pnpm smoke:token` + smoke script usage
  - Org routes require OAuth Bearer; api-key returns `403`

- [ ] **Phase 0 complete when:**

  1. All public-api tests pass (`pnpm --filter @apps/public-api test`).
  2. `smoke-mobile-auth.sh` succeeds using token from `smoke:token`.
  3. OpenAPI documents all Phase 0 routes + error shapes.
  4. Mobile repo can register, PKCE login, call `/v1/me`, `/v1/organizations`, and `/v1/orgs/{orgId}/ping` without backend changes.

---

## Mobile client contract (reference for Ignite companion repo)

1. `POST /v1/auth/register` — create account (then PKCE login on auth server). On duplicate email, show error and offer sign-in (not a silent success).
2. PKCE on auth server — obtain access + refresh tokens; store in secure storage.
3. `GET /v1/me` — profile only (no server active org).
4. `GET /v1/organizations` — org picker when count ≠ 1.
5. Persist selected `orgId` in MMKV (or equivalent).
6. Every org-scoped call: `/v1/orgs/{orgId}/…` with explicit path param.
7. `GET /v1/orgs/{orgId}/ping` — optional membership check before domain routes.

**Config (mobile repo):**

- `AUTH_BASE_URL` → `BETTER_AUTH_URL`
- `API_BASE_URL` → `PUBLIC_API` / `NEXT_PUBLIC_API_URL`

---

## Error shape (stable for mobile / apisauce)

All public-api errors use:

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Human-readable message"
  }
}
```

---

## Non-goals (Phase 0)

- OAuth authorize/token/refresh endpoints on public-api (auth server only).
- Server-side active organization (`activeOrganizationId`, `setActive`, synthetic sessions).
- Domain org routes beyond `/ping` stub.
- Patient-specific auth model (contacts, invitations) — future phase.
- CORS (native apps do not need it unless web auth hits API origin).
- Rate limiting changes beyond existing api-key limits.

---

## After Phase 0

Add org-scoped domain routes under `/v1/orgs/{orgId}/…` as product prioritizes. Mobile repo work (Ignite PKCE client, org picker, MMKV `orgId`) can run **in parallel** once Phase 0 routes are stable.
