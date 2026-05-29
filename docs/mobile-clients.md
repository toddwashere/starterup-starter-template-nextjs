# Mobile clients (Expo/RN, Flutter, native)

Consumer mobile apps live in **separate repositories**. They use this monorepo’s shared auth server and public REST API.

## Environment

| Variable | Purpose | Example (local) |
|----------|---------|-----------------|
| `AUTH_BASE_URL` | Auth server — Better Auth OAuth authorize/token/refresh (PKCE) | `http://localhost:4000` (`BETTER_AUTH_URL`) |
| `API_BASE_URL` | Public API — `/v1/*` REST routes | `http://localhost:4002` (`NEXT_PUBLIC_API_URL`) |

Configure these at build time or via remote config in each mobile app.

## Authentication

1. Register an OAuth client on the Better Auth OAuth Provider (dashboard-hosted auth server).
   - Use **Authorization Code + PKCE** (required for mobile).
   - Register redirect URIs per platform (custom URL scheme, universal links / app links).
   - Starter scopes: `account:read`, `offline_access` (refresh tokens).

2. After login, store access and refresh tokens in **platform secure storage** (Keychain, Keystore, etc.).

3. Call the public API with:

   ```http
   Authorization: Bearer <access_token>
   ```

4. Refresh tokens via the auth server token endpoint before expiry. On failure, sign the user out and restart PKCE.

**OAuth scopes:** the `account:read` scope is required by the public API on `/v1/me`, `/v1/organizations`, and `/v1/orgs/{orgId}/ping` (enforced by middleware). The `offline_access` scope is used by the auth server to mint refresh tokens; it is not consumed by the public API.

**Do not** embed API keys (`sk_org_…`, `sk_user_…`) in consumer app binaries. API keys are for integrations managed in the dashboard.

**Do not** rely on cookie-based sessions in native apps.

## API routes (v1 starter)

| Route | Auth | Purpose |
|-------|------|---------|
| `POST /v1/auth/register` | None | Email/password sign-up. Then run PKCE on the auth server to obtain tokens. |
| `GET /v1/me` | OAuth Bearer | User profile `{ id, name, email, image }` |
| `GET /v1/organizations` | OAuth Bearer | Org memberships (org picker) |
| `GET /v1/account` | `x-api-key` only | Integration key identity (not for consumer apps) |
| `GET /v1/orgs/{orgId}/ping` | OAuth Bearer | Org membership probe (stub; pattern for future org routes) |

**Org routes require OAuth Bearer.** `/v1/orgs/{orgId}/…` routes reject `x-api-key` auth and return **403**. API-key callers bypass scope checks but are not granted org access.

`POST /v1/auth/register` body is `{ name, email, password }` and returns `201 { user: { id, name, email } }`. A duplicate email returns `400` with `{ error: { code: "VALIDATION_ERROR", message: "An account with this email already exists. Sign in instead." } }` — surface this as a "sign in instead" prompt, not a silent success.

OpenAPI docs: run `public-api` and open `/docs` on the API base URL.

## Organization scoping

Phase 0 has **no server-side active organization** in the public API.

- User-level routes (`/v1/me`, `/v1/organizations`) work **without** a selected org.
- Every org-scoped call carries an **explicit `orgId` in the path** — `/v1/orgs/{orgId}/…` (e.g. `/v1/orgs/{orgId}/contacts` when added). There is no header-only org context.
- The mobile client stores the selected `orgId` **locally** (e.g. MMKV) and passes it on each org-scoped request. The public API does not read or write an active org, so **no `organization.setActive`** call is needed for API access, and there is **no** `PATCH /v1/me/active-organization`.
- Push/realtime handlers should use `orgId` from the event payload.

## Mobile client contract (flow)

Reference order of operations for a Phase 0 mobile client (e.g. the Ignite companion repo):

1. **Register** — `POST /v1/auth/register` with `{ name, email, password }`. On `201`, continue. On duplicate email (`400 VALIDATION_ERROR`), show the error and offer **sign in** — do not treat it as success.
2. **PKCE login** — run Authorization Code + PKCE against the auth server (`AUTH_BASE_URL`). Store the resulting **access + refresh tokens** in secure storage.
3. **Profile** — `GET /v1/me` → `{ id, name, email, image }`.
4. **Org picker** — `GET /v1/organizations`. When the membership count ≠ 1, present a picker; with exactly one org, auto-select it.
5. **Persist selection** — store the chosen `orgId` **locally** (MMKV). There is no server-side active org.
6. **Org-scoped calls** — every org request uses the explicit path `/v1/orgs/{orgId}/…` with the persisted `orgId`.
7. **Membership check (optional)** — `GET /v1/orgs/{orgId}/ping` to verify access before deeper org calls.

## Error handling

All public-API errors use a stable JSON shape:

```json
{ "error": { "code": "...", "message": "..." } }
```

`code` is one of `UNAUTHORIZED`, `FORBIDDEN`, `RATE_LIMITED`, `NOT_FOUND`, `VALIDATION_ERROR`, `INTERNAL_ERROR`.

For the target stack — **Infinite Red Ignite** (Expo/React Native, [apisauce](https://github.com/infinitered/apisauce), MMKV) — map HTTP status to UX in a single response transform:

| Status | Meaning | Client action |
|--------|---------|---------------|
| `401` | Token missing/expired/invalid | Refresh token; if refresh fails, sign out and restart PKCE |
| `403` | Authenticated but not permitted (wrong auth type or no org membership) | Show a permission/access-denied UI |
| `429` | Rate limited (`RATE_LIMITED`) | Back off and retry (honor `Retry-After` if present) |
| `400` | `VALIDATION_ERROR` | Surface `error.message` in the form |

## Client generation

Generate HTTP clients from `GET {API_BASE_URL}/openapi.json` per stack (OpenAPI Generator, etc.). No need to import `@workspace/auth` in mobile repos.

Inspect the spec directly:

```bash
curl -s "$API_BASE_URL/openapi.json" | head
```

## Local development

1. Start dashboard (auth on port 4000).
2. Start public API: `pnpm --filter @apps/public-api dev` (port 4002).
3. Obtain a dev access token (registers the smoke user + drives a PKCE sign-in
   against the auth server) and run the smoke checks:

   ```bash
   # obtain a dev access token and export ACCESS_TOKEN / API_BASE_URL into the shell
   eval "$(pnpm --filter @apps/public-api smoke:token --print-env)"
   # run the smoke checks (GET /v1/me, /v1/organizations, optional /v1/orgs/$ORG_ID/ping)
   ./apps/public-api/scripts/smoke-mobile-auth.sh
   ```

   The helper reads `AUTH_BASE_URL`, `API_BASE_URL`, `SMOKE_EMAIL`,
   `SMOKE_PASSWORD`, `SMOKE_NAME`, `SMOKE_OAUTH_REDIRECT_URI`, and optional
   `SMOKE_OAUTH_CLIENT_ID` (run with `--help` for details). It is local-only and
   commits no secrets.

4. Or call the API directly with any access token:

   ```bash
   curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4002/v1/me
   curl -s -H "Authorization: Bearer $TOKEN" http://localhost:4002/v1/organizations
   ```

## Phase 0 — definition of done

- All `@apps/public-api` tests pass (`pnpm --filter @apps/public-api test`).
- The smoke script (`scripts/smoke-mobile-auth.sh`) succeeds end-to-end with a token from `smoke:token`.
- OpenAPI (`/openapi.json`) documents every Phase 0 route (`POST /v1/auth/register`, `GET /v1/me`, `GET /v1/organizations`, `GET /v1/account`, `GET /v1/orgs/{orgId}/ping`) and the `{ error: { code, message } }` error shape.
- A mobile repo can **register**, complete **PKCE login**, and call `/v1/me`, `/v1/organizations`, and `/v1/orgs/{orgId}/ping` with **no backend changes**.

## Related specs

- [`docs/superpowers/specs/2026-05-25-mobile-public-api-design.md`](superpowers/specs/2026-05-25-mobile-public-api-design.md)
- [`docs/superpowers/specs/2026-05-16-mcp-oauth-account-info-design.md`](superpowers/specs/2026-05-16-mcp-oauth-account-info-design.md) (OAuth verification pattern)
