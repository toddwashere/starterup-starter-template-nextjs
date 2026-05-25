# Mobile Clients & Public API Design

**Date:** 2026-05-25  
**Status:** Approved

## Overview

First-party and partner mobile applications (separate repositories) will authenticate users against the monorepo’s shared Better Auth deployment and call a single versioned REST surface: `apps/public-api`. The design extends `public-api` with OAuth Bearer authentication (aligned with `apps/public-mcp`), explicit organization scoping on org routes, and user-level routes that do not require an active organization. API keys remain for integrations and dashboard-managed companion flows (**D**); consumer mobile apps use OAuth only and must not embed API keys.

**Audiences:** end users (**A**), customers’ users under multi-tenant orgs on one global host (**B**), and integration-oriented companion use (**D**).

**Platforms:** Expo/React Native, Flutter, and fully native iOS/Android — all consuming the same HTTP contract (no monorepo TypeScript client required in mobile repos).

**Out of scope for this spec:** a dedicated `mobile-api` BFF, per-customer API/auth hosts, MCP as the mobile transport, and v1 push notification infrastructure (documented as a future extension).

---

## Key Decisions

| Decision | Choice |
|----------|--------|
| API surface | Single `public-api` (`/v1/...`), OpenAPI-generated clients per mobile stack |
| Auth for mobile | OAuth 2.1 Authorization Code + PKCE → Bearer access token (refresh via auth server) |
| Auth for integrations | Existing `x-api-key` on `public-api` (unchanged) |
| Hosting | One `BETTER_AUTH_URL` and one public API base URL for all tenants; tenant = org membership |
| Org scoping | **Required explicit org** on org-scoped routes (path or header); optional `setActive` when user commits to a workspace |
| Active org on server | Supported for parity with dashboard; **not** the sole source of org context for org-scoped API calls |
| Mobile repos | Separate from monorepo; no direct `@workspace/database` or server actions |
| BFF | None for v1 unless push/uploads or true multi-host white-label appear later |

---

## Architecture

```text
┌─────────────────┐     PKCE / token      ┌──────────────────┐
│ Mobile apps     │ ──────────────────────► │ BETTER_AUTH_URL  │
│ (RN/Flutter/    │                         │ (dashboard mount)│
│  native)        │                         └────────┬─────────┘
└────────┬────────┘                                  │
         │ Bearer (+ org path/header)                │ sessions, org plugin
         ▼                                           ▼
┌─────────────────┐                         ┌──────────────────┐
│ public-api      │ ── domain packages ───► │ PostgreSQL /     │
│ /v1/*           │                         │ Prisma           │
└─────────────────┘                         └──────────────────┘
```

Mobile apps talk to two HTTP origins:

1. **Auth server** (`BETTER_AUTH_URL`, default `http://localhost:4000`) — authorization, token, refresh, and optionally Better Auth organization endpoints (`setActive`, list orgs) if not fully duplicated on `public-api`.
2. **Public API** (`PUBLIC_API` base, default port `4002`) — versioned REST, OpenAPI docs, domain data.

---

## Authentication

### OAuth clients

Register one or more OAuth clients on the existing Better Auth OAuth Provider (same plugin as MCP):

- Separate clients per app or per platform (Expo, Flutter, iOS, Android) with platform-specific redirect URIs (custom URL scheme, universal links / app links).
- Scopes grow with resources (starter: `account:read`, `offline_access`; later e.g. `contacts:read`, `contacts:write`).
- Dynamic client registration policy follows existing auth config (`allowDynamicClientRegistration`, etc.).

### Token handling (all mobile platforms)

- Use **Authorization Code + PKCE**; no password grant; no long-lived API keys in the app binary.
- Store access and refresh tokens in **platform secure storage** only.
- Send `Authorization: Bearer <access_token>` to `public-api`.
- Refresh tokens via the auth server token endpoint before expiry; on refresh failure, force re-login.

### Dual auth on `public-api`

Extend `public-api` middleware to mirror `apps/public-mcp/src/middleware/mcp-auth.ts`:

1. **`x-api-key`** — existing integration path (`verifyApiKey` → `apiKeyContext`).
2. **`Authorization: Bearer`** — verify OAuth JWT via `@better-auth/oauth-provider/resource-client` (same as MCP); optional session bearer fallback is **not** required for mobile (session/cookie remains dashboard-only).

Rejected or missing credentials return standardized JSON errors (`401`, `403`, `429`) consistent with existing `apps/public-api/src/lib/errors.ts`.

### Discriminated request context

Handlers receive a unified context union (names illustrative):

```ts
type PublicApiAuthContext =
  | { kind: "oauth"; userId: string; orgId: string | null; scopes: string[]; clientId: string | null }
  | { kind: "api-key"; keyId: string; ownerType: "organization" | "user"; userId: string | null; orgId: string | null; permissions: Record<string, string[]> };
```

Do not expose tokens, refresh tokens, or API key values in response bodies.

---

## Organization Model

### User states

| State | Description |
|-------|-------------|
| Authenticated, no org context | Valid user token; `activeOrganizationId` may be null |
| Authenticated, org context | User is operating in a specific org (explicit on request and/or synced via `setActive`) |

### Explicit org on org-scoped routes (required)

Org-scoped routes **must** identify the target org in the request, not infer solely from session `activeOrganizationId`:

- **Preferred:** path prefix `/v1/orgs/{orgId}/...` (e.g. `/v1/orgs/{orgId}/contacts`).
- **Alternative:** header `X-Organization-Id` on routes that are not path-prefixed (document one canonical approach in OpenAPI).

Middleware for org routes:

1. Resolve `userId` from OAuth context.
2. Resolve `orgId` from path or header.
3. Verify membership and permissions for that org (same vocabulary as dashboard / API keys: `contact:read`, etc.).
4. Pass `orgId` into domain repository calls.

Return `400` when org is required but missing; `403` when user lacks membership or permission; `401` when unauthenticated.

### Optional `setActive` (sync only)

When the user **commits** to a workspace (e.g. org picker “Continue”):

- Call Better Auth `organization.setActive({ organizationId })` against the auth server (HTTP from mobile).
- Treat this as **syncing** UI choice to the server, not as the only org binding for API calls.

Mobile must still send **explicit `orgId`** on org-scoped `public-api` requests to avoid stale-session races (parallel requests, background tasks, second device, push handlers).

### Push and realtime (future)

Event payloads **must** include `orgId` (and entity ids). Handlers route by payload org, not by refetching “current active org” from the server alone.

---

## Route Tiers

Apply middleware per route group — **do not** apply global `apiKeyAuth` + `orgScope` to all `/v1/*`.

| Tier | Auth | Org | Example routes |
|------|------|-----|----------------|
| **User** | OAuth or api-key (user-owned key) | None | `GET /v1/me`, `GET /v1/organizations` |
| **Org-scoped** | OAuth (typical) or org api-key | Explicit `orgId` required | `GET /v1/orgs/{orgId}/contacts` (future) |
| **Integration account** | Api-key only | From key context | `GET /v1/account` (existing key identity) |

### v1 starter routes (monorepo)

**Ship in first implementation slice:**

- OAuth Bearer middleware on `public-api`.
- `GET /v1/me` — user profile, `activeOrganizationId` if present, no org required.
- `GET /v1/organizations` — memberships the user can access (ids, names, slugs, roles as needed for org picker).
- Keep `GET /v1/account` for **api-key** identity (integration / **D**); OpenAPI security schemes distinguish Bearer vs apiKey.

**Defer to follow-up slices (same auth model):**

- Domain resources (contacts, tasks, etc.) under `/v1/orgs/{orgId}/...` as product prioritizes.
- Composite/batch routes if profiling shows chatty mobile screens.

### OpenAPI

- Document both `apiKey` and `Bearer` security schemes.
- Tag routes by tier; org routes document `orgId` path param and error responses.
- Mobile repos generate clients from published OpenAPI (no requirement to import `@workspace/auth` in app code).

---

## Multi-Platform Client Guidance

| Platform | Auth | API |
|----------|------|-----|
| Expo / React Native | PKCE via `expo-auth-session` or equivalent; secure store for tokens | `fetch` / generated OpenAPI client |
| Flutter | `flutter_appauth` or equivalent | `dio` + generated client |
| iOS / Android native | `ASWebAuthenticationSession` / Custom Tabs + PKCE | Platform HTTP + generated client |

**Do not** rely on `better-auth/react` or cookie sessions in mobile apps. **Do** use the same redirect URIs registered per OAuth client.

Environment configuration in each mobile app (build-time or remote config):

- `AUTH_BASE_URL` → `BETTER_AUTH_URL`
- `API_BASE_URL` → public API deployment URL

---

## Audience-Specific Notes

### A — End users

Standard flow: sign in → `GET /v1/me` + `GET /v1/organizations` → org picker → optional `setActive` → org-scoped screens with explicit `orgId` on each API call.

### B — Customers’ users (multi-tenant)

Single global auth and API host; authorization is org membership and permissions. Branding and copy are client-side. No tenant-discovery BFF.

### D — Integration companion

- API keys are created and revoked in the **dashboard** only.
- Scripts and partner integrations call `public-api` with `x-api-key`.
- Consumer mobile apps use OAuth; an in-app “developer mode” with user-owned keys is optional later and still must not ship org keys in the binary.

---

## Security & Operations

- Rate limits: reuse Better Auth API key rate limiting for key auth; apply OAuth-appropriate limits for Bearer (align with existing MCP/API patterns).
- CORS: configure `public-api` for mobile if any web-based auth flows hit the API origin; native apps typically do not need CORS for API calls.
- Audit: log auth kind, user id, org id, route, and outcome for sensitive routes (pattern aligned with MCP audit guidance where applicable).
- Observability: `public-api` already supports Sentry via `packages/observability`; include OAuth auth failures in error reporting without logging tokens.

---

## Non-Goals

- `apps/mobile-api` BFF in v1.
- Per-customer API or auth base URLs.
- Embedding `sk_org_` / `sk_user_` in consumer mobile binaries.
- Dashboard server actions as mobile backend.
- MCP JSON-RPC as the primary mobile transport.
- Cookie-based session as the primary mobile auth mechanism.

---

## Future Extensions (not v1)

| Extension | Trigger |
|-----------|---------|
| Thin BFF or `public-api` device routes | Push registration, presigned uploads, app attestation |
| Composite routes | Profiling shows excessive round-trips per screen |
| Additional OAuth scopes | New domain routes added to `public-api` |

---

## Critical Tests

- `apps/public-api/src/middleware/bearer-auth.test.ts`: valid OAuth JWT sets `oauth` context; expired/invalid token returns `401`; missing Bearer on protected route returns `401`.
- `apps/public-api/src/middleware/org-context.test.ts`: org route with valid membership proceeds; non-member returns `403`; missing `orgId` returns `400`; OAuth user cannot access org A using org B id in path.
- `apps/public-api/src/middleware/api-key-auth.test.ts`: existing api-key behavior unchanged when `x-api-key` present without Bearer.
- `apps/public-api/src/routes/v1/me.test.ts`: OAuth caller receives user id and nullable `activeOrganizationId` without org permission; no secrets in body.
- `apps/public-api/src/routes/v1/organizations.test.ts`: returns only orgs the user belongs to; empty list for user with no memberships.
- `apps/public-api/src/routes/v1/account.test.ts`: api-key-only semantics preserved; Bearer cannot replace key for integration account shape unless explicitly designed.

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test` filtered to `apps/public-api` and any new `packages/auth` helpers introduced for org membership checks on public API

---

## Related Documents

- [`2026-05-10-public-api-and-mcp-design.md`](./2026-05-10-public-api-and-mcp-design.md) — original public API and api-key design
- [`2026-05-16-mcp-oauth-account-info-design.md`](./2026-05-16-mcp-oauth-account-info-design.md) — OAuth Bearer verification pattern to reuse
- [`packages/auth/src/guards.ts`](../../../packages/auth/src/guards.ts) — dashboard `requireUser` vs `requireOrgPermissionWithActiveOrg`

---

## Implementation Handoff

After this spec is reviewed, create an implementation plan via the writing-plans skill: `docs/superpowers/plans/2026-05-25-mobile-public-api.md`.
