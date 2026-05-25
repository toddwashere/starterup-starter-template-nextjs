# Organization Multi-Role & Extensible Static Roles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable multiple Better Auth org roles per member (CSV on `Member.role`), centralize static role definitions in one registry, and replace role-string UI gates with `hasPermission` / shared helpers—without shipping roles beyond owner/admin/member.

**Architecture:** Refactor `packages/auth/src/permissions.ts` into `org-roles/`; register `orgRoles` on server and client organization plugins; add `parseOrgRoles` in `@workspace/common` for packages that cannot depend on `@workspace/auth` (billing); dashboard uses server permission-context actions for UI gates.

**Tech Stack:** Better Auth organization plugin (`better-auth@^1.6.11`), Prisma `Member.role`, Vitest, Next.js dashboard.

**Design spec:** [`docs/superpowers/specs/2026-05-25-org-multi-role-static-roles-design.md`](../specs/2026-05-25-org-multi-role-static-roles-design.md)

---

## File Structure

| Action | Path |
|--------|------|
| Create | `packages/common/src/parse-org-roles.ts` |
| Create | `packages/common/src/parse-org-roles.test.ts` |
| Create | `packages/auth/src/org-roles/statement.ts` |
| Create | `packages/auth/src/org-roles/roles.ts` |
| Create | `packages/auth/src/org-roles/index.ts` |
| Create | `packages/auth/src/org-roles/org-roles.test.ts` |
| Create | `packages/auth/src/org-roles/member-permissions.ts` |
| Create | `packages/auth/src/org-roles/member-permissions.test.ts` |
| Modify | `packages/auth/src/permissions.ts` (re-export from org-roles) |
| Modify | `packages/auth/src/auth.ts` |
| Modify | `packages/auth/src/auth-client.ts` |
| Modify | `packages/auth/package.json` (exports `./org-roles`) |
| Modify | `packages/billing/src/authorize-org-billing.ts` |
| Modify | `packages/billing/src/authorize-org-billing.test.ts` |
| Modify | `packages/auth/src/public-api/org-membership.ts` |
| Modify | `packages/auth/src/public-api/org-membership.test.ts` |
| Create | `packages/auth/src/org-permission-context.ts` |
| Create | `packages/auth/src/org-permission-context.test.ts` |
| Modify | `apps/dashboard/features/organization/data/billing-actions.ts` (optional: use shared helper) |
| Create | `apps/dashboard/features/organization/data/org-permission-actions.ts` |
| Modify | `apps/dashboard/features/api-keys/ui/api-keys-page-content.tsx` |
| Modify | `apps/dashboard/features/organization/ui/members-page-content.tsx` |
| Modify | `apps/dashboard/features/organization/ui/update-member-role-dialog.tsx` |
| Modify | `apps/dashboard/features/organization/ui/org-provider.tsx` |
| Modify | `apps/dashboard/features/organization/data/org-types.ts` |
| Create | `.ai/conventions/org-roles.md` |
| Modify | `.cursor/rules/shared-ai-guidance.mdc` (trigger for org-roles convention) |

---

## Critical Tests

- `packages/common/src/parse-org-roles.test.ts`: single role, CSV, trim spaces, empty segments dropped.
- `packages/auth/src/org-roles/org-roles.test.ts`: default roles registered; `OrgRoleId` covers owner/admin/member.
- `packages/auth/src/org-roles/member-permissions.test.ts`: `memberRoleFieldHasPermission("admin,member", { apiKey: ["read"] })` true; `"member"` false for apiKey create.
- `packages/auth/src/permissions.test.ts`: unchanged permission boundaries after refactor (move or keep file).
- `packages/billing/src/authorize-org-billing.test.ts`: `"admin,member"` allows billing; `"member"` denies.
- `packages/auth/src/public-api/org-membership.test.ts`: `assertUserOrgMember` / list returns `roles: string[]`.
- `packages/auth/src/org-permission-context.test.ts`: returns allowed false when `hasPermission` fails (mocked).

---

## Task 0: Spike — confirm Better Auth multi-role on installed version

**Files:** None (manual or temporary test file deleted after)

- [ ] **Step 1:** In a dev environment with DB, call `authClient.organization.updateMemberRole({ memberId, organizationId, role: ["admin", "member"] })`.

- [ ] **Step 2:** Confirm DB `Member.role` is `"admin,member"` (or equivalent CSV).

- [ ] **Step 3:** Call `auth.api.hasPermission` with `{ apiKey: ["read"] }` for that user/org — expect success.

- [ ] **Step 4:** If spike fails, upgrade `better-auth` / `@better-auth/*` to a version with multi-role support before Task 1.

---

## Task 1: `parseOrgRoles` in `@workspace/common`

**Files:**

- Create: `packages/common/src/parse-org-roles.ts`
- Create: `packages/common/src/parse-org-roles.test.ts`
- Modify: `packages/common/src/index.ts`

- [ ] **Step 1: Write failing test**

```ts
// packages/common/src/parse-org-roles.test.ts
import { describe, it, expect } from "vitest";
import { parseOrgRoles } from "./parse-org-roles";

describe("parseOrgRoles", () => {
  it("parses a single role", () => {
    expect(parseOrgRoles("admin")).toEqual(["admin"]);
  });
  it("parses comma-separated roles with spaces", () => {
    expect(parseOrgRoles("admin, member")).toEqual(["admin", "member"]);
  });
  it("drops empty segments", () => {
    expect(parseOrgRoles("admin,,member")).toEqual(["admin", "member"]);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `pnpm --filter @workspace/common test`

- [ ] **Step 3: Implement**

```ts
// packages/common/src/parse-org-roles.ts
export function parseOrgRoles(roleField: string): string[] {
  return roleField
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
```

Export from `packages/common/src/index.ts`.

- [ ] **Step 4: Run test — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add packages/common/src/parse-org-roles.ts packages/common/src/parse-org-roles.test.ts packages/common/src/index.ts
git commit -m "feat(common): add parseOrgRoles for CSV member roles"
```

---

## Task 2: Org role registry (`packages/auth/src/org-roles`)

**Files:**

- Create: `packages/auth/src/org-roles/statement.ts`
- Create: `packages/auth/src/org-roles/roles.ts`
- Create: `packages/auth/src/org-roles/index.ts`
- Create: `packages/auth/src/org-roles/org-roles.test.ts`
- Modify: `packages/auth/src/permissions.ts`
- Modify: `packages/auth/package.json`

- [ ] **Step 1:** Move `statement` and `ac` from current `permissions.ts` to `org-roles/statement.ts`.

- [ ] **Step 2:** Move `owner`, `admin`, `member` `ac.newRole(...)` definitions to `org-roles/roles.ts`.

- [ ] **Step 3:** In `org-roles/index.ts` export:

```ts
export { ac, statement } from "./statement";
export { owner, admin, member } from "./roles";
export const orgRoles = { owner, admin, member } as const;
export type OrgRoleId = keyof typeof orgRoles;
export const ASSIGNABLE_ORG_ROLE_IDS = ["owner", "admin", "member"] as const satisfies readonly OrgRoleId[];
```

- [ ] **Step 4:** Replace `permissions.ts` body with re-exports:

```ts
export { ac, orgRoles, permissions } from "./org-roles/index";
// permissions = orgRoles alias for backward compat
```

Ensure existing `permissions.owner` etc. still work (alias `export const permissions = orgRoles` or keep `permissions` key name in tests).

- [ ] **Step 5:** Add `org-roles.test.ts` asserting three keys on `orgRoles`.

- [ ] **Step 6:** Add `"./org-roles": "./src/org-roles/index.ts"` to `packages/auth/package.json` exports.

- [ ] **Step 7:** Run `pnpm --filter @workspace/auth test` — fix `permissions.test.ts` imports if paths changed.

- [ ] **Step 8: Commit**

```bash
git commit -m "refactor(auth): centralize org roles in org-roles registry"
```

---

## Task 3: `memberRoleFieldHasPermission` helper

**Files:**

- Create: `packages/auth/src/org-roles/member-permissions.ts`
- Create: `packages/auth/src/org-roles/member-permissions.test.ts`

- [ ] **Step 1: Write failing tests** for union across CSV roles using `orgRoles[id].authorize(...)`.

- [ ] **Step 2: Implement**

```ts
import { parseOrgRoles } from "@workspace/common";
import { orgRoles, type OrgRoleId } from "./index";

export function memberRoleFieldHasPermission(
  roleField: string,
  required: Record<string, string[]>,
): boolean {
  const ids = parseOrgRoles(roleField);
  return ids.some((id) => {
    const role = orgRoles[id as OrgRoleId];
    return role?.authorize(required).success === true;
  });
}
```

- [ ] **Step 3: Run auth tests — PASS**

- [ ] **Step 4: Commit**

---

## Task 4: Wire `orgRoles` into server and client plugins

**Files:**

- Modify: `packages/auth/src/auth.ts`
- Modify: `packages/auth/src/auth-client.ts`

- [ ] **Step 1:** In `auth.ts`, import `{ ac, orgRoles } from "./org-roles"` and pass `roles: orgRoles` to `organization({ ac, roles: orgRoles, ... })`.

- [ ] **Step 2:** In `auth-client.ts`, import `{ ac, orgRoles } from "./org-roles"` and use `organizationClient({ ac, roles: orgRoles })`.

- [ ] **Step 3:** Run `pnpm --filter @workspace/auth type-check`

- [ ] **Step 4: Commit**

---

## Task 5: Fix billing `authorizeOrgBilling` for CSV roles

**Files:**

- Modify: `packages/billing/src/authorize-org-billing.ts`
- Modify: `packages/billing/src/authorize-org-billing.test.ts`

- [ ] **Step 1: Add failing test**

```ts
it("allows admin when role field is CSV admin,member", async () => {
  vi.mocked(prisma.member.findFirst).mockResolvedValue({ role: "admin,member" } as never);
  const ok = await authorizeOrgBilling({ user: { id: "u1" }, referenceId: "org_1", action: "x" });
  expect(ok).toBe(true);
});
```

- [ ] **Step 2: Update implementation**

```ts
import { parseOrgRoles } from "@workspace/common";

const BILLING_MANAGE_ROLES = new Set(["owner", "admin"]);

// inside authorizeOrgBilling after fetching member:
return !!member && parseOrgRoles(member.role).some((r) => BILLING_MANAGE_ROLES.has(r));
```

Add `@workspace/common` to `packages/billing/package.json` dependencies if missing.

- [ ] **Step 3: Run `pnpm --filter @workspace/billing test`**

- [ ] **Step 4: Commit**

Document in `.ai/conventions/org-roles.md`: adopters adding a custom billing-capable role must add that role id to `BILLING_MANAGE_ROLES` or refactor authorize to permission helper (future).

---

## Task 6: Public API `roles[]` shape

**Files:**

- Modify: `packages/auth/src/public-api/org-membership.ts`
- Modify: `packages/auth/src/public-api/org-membership.test.ts`
- Modify: any mobile/public-api types consuming `role` (grep `UserOrganizationSummary`)

- [ ] **Step 1:** Change `UserOrganizationSummary` to `roles: string[]`.

- [ ] **Step 2:** `assertUserOrgMember` returns `string[]` (parsed).

- [ ] **Step 3:** `listOrganizationsForUser` maps `roles: parseOrgRoles(m.role)`.

- [ ] **Step 4:** Update tests and fix compile errors in `apps/public-api` / mobile plan worktree if present.

- [ ] **Step 5: Commit**

---

## Task 7: `getOrgPermissionContext` server helper

**Files:**

- Create: `packages/auth/src/org-permission-context.ts`
- Create: `packages/auth/src/org-permission-context.test.ts`
- Modify: `packages/auth/package.json` export `./org-permission-context`

- [ ] **Step 1:** Implement (mirror `getBillingContextForOrg`):

```ts
export async function getOrgPermissionContext(
  organizationId: string,
  permissions: Record<string, string[]>,
): Promise<{ allowed: boolean }> {
  try {
    const result = await auth.api.hasPermission({
      headers: await headers(),
      body: { organizationId, permissions },
    });
    return { allowed: result?.success === true };
  } catch {
    return { allowed: false };
  }
}
```

- [ ] **Step 2:** Unit test with mocked `auth.api.hasPermission`.

- [ ] **Step 3: Commit**

---

## Task 8: Dashboard permission context action

**Files:**

- Create: `apps/dashboard/features/organization/data/org-permission-actions.ts`

- [ ] **Step 1:** Add server action wrapper:

```ts
"use server";
import { getOrgPermissionContext } from "@workspace/auth/org-permission-context";

export async function getApiKeyManageContextAction(organizationId: string) {
  const read = await getOrgPermissionContext(organizationId, { apiKey: ["read"] });
  const create = await getOrgPermissionContext(organizationId, { apiKey: ["create"] });
  return { canRead: read.allowed, canCreate: create.allowed };
}
```

- [ ] **Step 2: Commit**

---

## Task 9: API keys page — permission context instead of role string

**Files:**

- Modify: `apps/dashboard/features/api-keys/ui/api-keys-page-content.tsx`

- [ ] **Step 1:** Remove `currentRole` / `canManageApiKeys` role equality logic.

- [ ] **Step 2:** Use `useQuery` with `getApiKeyManageContextAction(organization.id)` when org loaded.

- [ ] **Step 3:** Gate load / Create button on `canRead` / `canCreate`.

- [ ] **Step 4:** Manual check: member role cannot create; admin can.

- [ ] **Step 5: Commit**

---

## Task 10: Members page — multi-role UI + permission gates

**Files:**

- Modify: `apps/dashboard/features/organization/ui/org-provider.tsx`
- Modify: `apps/dashboard/features/organization/ui/members-page-content.tsx`
- Modify: `apps/dashboard/features/organization/ui/update-member-role-dialog.tsx`
- Modify: `apps/dashboard/features/organization/data/org-types.ts`

- [ ] **Step 1:** In org-provider, add `roles: parseOrgRoles(member.role)` on each member (import from `@workspace/common`).

- [ ] **Step 2:** Members table — render one Badge per role in `roles` array.

- [ ] **Step 3:** Replace `canManageMembers` with `getOrgPermissionContext` query for `{ member: ["update"] }` (new action or reuse generic action with permission arg).

- [ ] **Step 4:** `isOwner` → `roles.includes("owner")`.

- [ ] **Step 5:** Update role dialog — multi-select (Checkbox group) for owner/admin/member; state `string[]`; call `updateMemberRole({ role: selectedRoles })`.

- [ ] **Step 6:** Owner policy — if selecting `owner` when another member already has owner, show error or require transfer (minimal: block second owner in UI by checking existing members).

- [ ] **Step 7:** Extend `updateMemberRoleSchema` to `z.array(z.enum([...])).min(1)` or accept union type BA expects.

- [ ] **Step 8: Commit**

---

## Task 11: Convention doc + AI trigger

**Files:**

- Create: `.ai/conventions/org-roles.md`
- Modify: `.cursor/rules/shared-ai-guidance.mdc`

- [ ] **Step 1:** Write convention: add-role checklist, multi-role BA usage, healthcare patterns (docs only), billing authorize note, audit phase 2.

- [ ] **Step 2:** Add trigger: “When adding or changing organization roles or org RBAC…”

- [ ] **Step 3: Commit**

---

## Task 12: Final verification

- [ ] **Step 1:** `pnpm type-check`

- [ ] **Step 2:** `pnpm lint`

- [ ] **Step 3:** `pnpm test --filter @workspace/auth`

- [ ] **Step 4:** `pnpm test --filter @workspace/billing`

- [ ] **Step 5:** `pnpm test --filter @workspace/common`

- [ ] **Step 6:** Run dashboard e2e smoke if env available: `pnpm --filter dashboard e2e` (API key member/owner scenarios)

- [ ] **Step 7: Commit** any fixes

---

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/common`
- `pnpm test --filter @workspace/auth`
- `pnpm test --filter @workspace/billing`

---

## Out of scope (phase 2)

- `OrgAuditEvent` table and membership audit UI
- Dynamic/customer-defined org roles
- Teams / resource-scoped permissions
