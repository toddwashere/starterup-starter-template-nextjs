# Organization Multi-Role & Extensible Static Roles

**Date:** 2026-05-25  
**Status:** Approved

## Overview

Extend the template’s organization RBAC so each member can hold **multiple static roles** per organization, using **Better Auth’s native multi-role storage** (comma-separated `Member.role` string and `role: string[]` on invite/update APIs). Centralize all role definitions in a single code registry so adding a new role is a predictable, documented checklist. Keep the shipped template at **three default roles** (`owner`, `admin`, `member`); provide **machinery and docs only** for adopters (e.g. healthcare) to add roles such as `auditor` or `billing_admin` without forking auth.

Replace ad-hoc `member.role === "admin"` checks with **`auth.api.hasPermission`** (or thin server helpers) so UI and server stay aligned with `packages/auth` access control. **Audit logging** for membership changes is supported and recommended but **out of scope for v1 implementation** (documented as phase 2).

**Outcomes:**

- Devs add a static role in one registry module; server and client plugins stay in sync.
- Members can have multiple roles; permissions union via Better Auth.
- No Prisma schema change for role storage; no junction table.
- Billing, API keys, members UI, and public API stop assuming a single role string.

---

## Decisions

| Topic | Decision |
|-------|----------|
| **Storage** | Better Auth option **B**: one `Member` row; `role` field stores CSV (e.g. `"admin,member"`) |
| **Permission source of truth** | `createAccessControl` statement + `ac.newRole()` map in `packages/auth` |
| **Enforcement** | `auth.api.hasPermission` / existing `requireOrgPermission*` guards |
| **Template default roles** | **A — machinery only:** ship `owner`, `admin`, `member`; no example healthcare roles in code |
| **Client plugin** | Pass `ac` + `orgRoles` to `organizationClient()` (parity with server `organization()`) |
| **Owner policy** | Document: one `owner` per org recommended; UI may block/warn `owner` + other roles |
| **Audit (v1)** | Not implemented; optional structured logs / `OrgAuditEvent` in phase 2 |
| **Non-goals** | Dynamic/customer-defined roles, teams, resource-scoped RBAC, PHI in audit payloads |

---

## Architecture

```text
┌─────────────────────────────────────────────────────────────────────────┐
│ apps/dashboard                                                           │
│  • Members UI: multi-select roles → updateMemberRole({ role: string[] })│
│  • Feature UI: getOrgPermissionContext(orgId, permissions) server actions│
│  • No raw role === "admin" for capability gates                          │
└───────────────────────────────┬─────────────────────────────────────────┘
                                │
                                ▼
┌───────────────────────────┐     ┌──────────────────────────────────────┐
│ packages/auth              │     │ Better Auth organization plugin       │
│  org-roles/ (registry)     │────►│  Member.role = "admin,member" (CSV)   │
│  parseOrgRoles(), helpers  │     │  hasPermission unions role permissions│
│  guards (unchanged API)    │     └──────────────────────────────────────┘
│  auth.ts + auth-client.ts  │
└───────────────────────────┬─┘
                            │
                            ▼
┌───────────────────────────┐
│ packages/database          │
│  Member.role String        │  (unchanged)
└───────────────────────────┘
```

### Dependency rules

- Apps import `@workspace/auth` guards and helpers; not `@prisma/client` for permission checks.
- Role registry lives only in `packages/auth`; dashboard imports `OrgRoleId`, `parseOrgRoles` from `@workspace/auth` (or subpath export).

---

## Better Auth multi-role behavior

**Verify during implementation** (spike / test) on `better-auth@^1.6.11`:

- `organization.updateMemberRole({ role: ["admin", "member"] })` persists CSV on `Member.role`.
- `auth.api.hasPermission` grants union of permissions across all roles in the CSV.
- `organization.inviteMember` accepts `role: string | string[]` where applicable.

If the installed version lacks multi-role, upgrade Better Auth before proceeding.

**Parsing convention (app helpers):**

- Split `Member.role` on `,`, trim whitespace, drop empty segments.
- Single role unchanged: `"admin"` → `["admin"]`.
- Export `parseOrgRoles(roleField: string): OrgRoleId[]` and `orgRolesInclude(roleField, ...roles)`.

Unknown role segments: treat as opaque strings for display; `hasPermission` is authoritative for access (BA will reject unknown roles on update if configured).

---

## Role registry (developer DX)

### New module layout

```text
packages/auth/src/org-roles/
  statement.ts    # ac statement (move from permissions.ts)
  roles.ts        # ac.newRole() for each OrgRoleId
  index.ts        # orgRoles map, OrgRoleId type, parseOrgRoles, orgRolesInclude
  org-roles.test.ts
```

Refactor existing `packages/auth/src/permissions.ts` into this structure (or re-export from `permissions.ts` for backward-compatible import paths during migration).

### `OrgRoleId` type

- v1: `"owner" | "admin" | "member"`.
- Becomes a union extended when adopters add roles in `roles.ts` and register in `orgRoles`.

### Server registration (`auth.ts`)

```ts
organization({
  ac,
  roles: orgRoles, // { owner, admin, member, ... }
}),
```

### Client registration (`auth-client.ts`)

```ts
organizationClient({
  ac,
  roles: orgRoles,
}),
```

Today the client uses bare `organizationClient()` — **must be fixed** for typed multi-role client APIs.

### Checklist doc (new)

Add `.ai/conventions/org-roles.md` (and link from `shared-ai-guidance.mdc`):

1. Add `ac.newRole({ ... })` in `roles.ts`.
2. Register key on `orgRoles` in `index.ts`.
3. Extend `OrgRoleId` / assignable-role lists for invite UI if needed.
4. Add unit tests for the new role’s permission boundaries.
5. Use `hasPermission` in server actions; use `getOrgPermissionContext` in UI.
6. No DB migration when only adding static roles.

Include a **healthcare patterns** section (documentation only): separation of duties, least privilege, audit role changes, no PHI in logs — not shipped role names.

---

## Server authorization

### Keep

- `requireUser`, `requireOrgPermission`, `requireOrgPermissionWithActiveOrg` in `packages/auth/src/guards.ts`.

### Replace role-string checks

| Location | Change |
|----------|--------|
| `packages/billing/src/authorize-org-billing.ts` | Use permission check equivalent to `{ billing: ["manage"] }` (query member via BA or `hasPermission` with org context), not `BILLING_MANAGE_ROLES.has(member.role)` |
| `packages/auth/src/public-api/org-membership.ts` | Return `roles: string[]` from `parseOrgRoles(member.role)`; document breaking change for consumers |
| Dashboard UI (api-keys, members, ai-chat if applicable) | Server actions returning `{ allowed: boolean }` from `hasPermission` |

### New helpers

**`getOrgPermissionContext(organizationId, permissions)`** in `packages/auth` or `apps/dashboard/features/organization/data/`:

- Non-throwing wrapper around `auth.api.hasPermission` (same pattern as `getBillingContextForOrg`).
- Used by client components via React Query.

**Optional:** `getCurrentMemberRoles(organizationId)` — returns parsed roles for display only.

---

## Dashboard UI

### Members page

- Parse `member.role` → multiple badges.
- `isOwner` → `orgRolesInclude(member.role, "owner")`.
- `canManageMembers` → `hasPermission({ member: ["update"] })` or context action, not `owner || admin` string compare.

### Update member role dialog

- Multi-select (checkboxes) for assignable roles: `owner`, `admin`, `member`.
- Submit `authClient.organization.updateMemberRole({ role: selectedRoles })`.
- Validate owner policy (warn or prevent multiple owners / owner + other roles per product rule).

### Invite member dialog

- Keep invite roles `admin` | `member` only (no inviting as `owner`).
- Document how to extend `inviteMemberSchema` for additional assignable roles.

### Org provider

- Expose `roles: string[]` on each member (derived via `parseOrgRoles`) alongside raw `role` if needed for debugging.

### API keys page

- Replace `currentRole === "owner" || currentRole === "admin"` with `getOrgPermissionContext` for `apiKey: ["read"]` / `["create"]`.

---

## Public API

- `assertUserOrgMember` → return `roles: string[]`.
- `UserOrganizationSummary.role` → `roles: string[]` (breaking; update mobile/public-api consumers in same initiative or follow-up plan).
- List orgs endpoint returns roles array per org membership.

---

## Owner policy

| Rule | Enforcement |
|------|-------------|
| One owner per org (recommended) | UI: prevent promoting second owner without demoting first; document transfer flow |
| `owner` combined with other roles | Default: discourage in UI; allow only if product explicitly enables |
| Deleting org | Still requires `organization: ["delete"]` (owner role in static matrix) |

---

## Audit logging (phase 2 — documented, not v1)

Audit is **orthogonal** to CSV multi-role storage. Recommended events:

| Event | Payload (no PHI) |
|-------|------------------|
| `member.roles_updated` | `orgId`, `actorUserId`, `targetMemberId`, `previousRoles[]`, `newRoles[]`, `timestamp` |
| `member.invited` | `orgId`, `inviterId`, `email`, `roles[]` |
| `member.removed` | `orgId`, `actorUserId`, `targetUserId`, `rolesAtRemoval[]` |

Implementation options: wrap dashboard `org-actions.ts`; Better Auth `databaseHooks`; append-only `OrgAuditEvent` table.

---

## Performance

| Concern | Assessment |
|---------|------------|
| CSV parse per request | Negligible (typically ≤ 5 roles) |
| `hasPermission` round-trip | Already used; no material regression |
| Member list payload | Slightly longer `role` strings |
| Caching | Not required for template; optional session cache if profiling shows need |

Not a blocker for healthcare-scale org sizes (tens–hundreds of members per org).

---

## Migration & compatibility

- **Existing data:** single-role strings (`"admin"`) remain valid; no migration.
- **Imports:** keep `permissions.ts` re-exports if external consumers exist.
- **E2E:** update tests that assume single role; add one test for member without `apiKey` read when only `member` role (unchanged) and owner/admin with create (unchanged).

---

## Critical Tests

- `packages/auth/src/org-roles/org-roles.test.ts`: `parseOrgRoles` for single role, CSV, spaces, empty; `orgRolesInclude` true/false.
- `packages/auth/src/permissions.test.ts` (or merged into org-roles): each default role’s resource boundaries unchanged after refactor.
- `packages/auth/src/guards.test.ts`: `requireOrgPermission` still throws 403 when `hasPermission` fails.
- `packages/billing/src/authorize-org-billing.test.ts`: `"admin,member"` CSV still authorizes billing when `billing:manage` granted; `"member"` alone denied.
- `packages/auth/src/public-api/org-membership.test.ts`: returns `roles` array; CSV parsed correctly.
- `apps/dashboard/features/organization/data/org-actions.test.ts` (if present or add): `updateMemberRole` passes role array to auth API.
- Manual / integration spike: `updateMemberRole({ role: ["admin","member"] })` then `hasPermission({ apiKey: ["read"] })` succeeds.

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/auth`
- `pnpm test --filter @workspace/billing`
- Targeted dashboard unit tests for org-actions / permission context
- `apps/dashboard` e2e smoke: member cannot create API key; owner/admin can (existing journeys)

---

## Implementation phasing (for plan)

1. **Registry + plugin parity** — org-roles module, auth.ts + auth-client.ts, tests, re-exports.
2. **Server fixes** — billing authorize, public-api roles shape, shared `getOrgPermissionContext`.
3. **Dashboard** — members multi-select, badges, API keys + billing UI gates via permission context.
4. **Docs** — `.ai/conventions/org-roles.md`, trigger in shared-ai-guidance.
5. **Phase 2 (separate spec/plan)** — audit logging.

---

## References

- `packages/auth/src/permissions.ts` — current static matrix
- `packages/auth/src/guards.ts` — `hasPermission` guards
- `apps/dashboard/features/organization/data/billing-actions.ts` — `getBillingContextForOrg` pattern
- Better Auth organization plugin docs — multi-role CSV storage
- `plans/01-add-auth.md` — original “static roles only” guidance (update after implementation)
