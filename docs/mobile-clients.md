# Mobile clients (Expo/RN, Flutter, native)

Consumer mobile apps live in **separate repositories**. They use this monorepo’s shared auth server and public REST API.

## Environment

| Variable | Purpose | Example (local) |
|----------|---------|-----------------|
| `AUTH_BASE_URL` | Better Auth (OAuth, token refresh, optional `setActive`) | `http://localhost:4000` (`BETTER_AUTH_URL`) |
| `API_BASE_URL` | Public API | `http://localhost:4002` (`NEXT_PUBLIC_API_URL`) |

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

**Do not** embed API keys (`sk_org_…`, `sk_user_…`) in consumer app binaries. API keys are for integrations managed in the dashboard.

**Do not** rely on cookie-based sessions in native apps.

## API routes (v1 starter)

| Route | Auth | Purpose |
|-------|------|---------|
| `GET /v1/me` | OAuth Bearer | User profile + nullable `activeOrganizationId` |
| `GET /v1/organizations` | OAuth Bearer | Org memberships (org picker) |
| `GET /v1/account` | `x-api-key` only | Integration key identity (not for consumer apps) |
| `GET /v1/orgs/{orgId}/ping` | OAuth Bearer | Org membership probe (stub; pattern for future org routes) |

OpenAPI docs: run `public-api` and open `/docs` on the API base URL.

## Organization scoping

- User-level routes work **without** a selected org.
- Org-scoped routes require **`orgId` in the path** (e.g. `/v1/orgs/{orgId}/contacts` when added).
- Optionally call Better Auth `organization.setActive` when the user commits to a workspace; still pass explicit `orgId` on org API calls to avoid stale-session races.
- Push/realtime handlers should use `orgId` from the event payload, not only server “active org”.

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

## Related specs

- [`docs/superpowers/specs/2026-05-25-mobile-public-api-design.md`](superpowers/specs/2026-05-25-mobile-public-api-design.md)
- [`docs/superpowers/specs/2026-05-16-mcp-oauth-account-info-design.md`](superpowers/specs/2026-05-16-mcp-oauth-account-info-design.md) (OAuth verification pattern)
