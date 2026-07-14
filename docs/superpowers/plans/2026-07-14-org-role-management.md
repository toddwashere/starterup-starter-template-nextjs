# Organization Role Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship secure individual, bulk, invitation, and ownership role management for organization owners and admins without changing the database schema.

**Architecture:** Keep Better Auth's CSV-backed `Member.role` field and static role registry. Add catalog metadata and pure hierarchy policy under `packages/auth`, then expose a server-only management service that reloads actor/target memberships, delegates normal role writes to Better Auth, and performs ownership transfer in one serializable Prisma transaction. Dashboard server actions validate inputs and drive responsive individual and bulk UI.

**Tech Stack:** Next.js 16 server actions, Better Auth 1.6.14, Prisma 7/PostgreSQL, Zod 3, React 19, TanStack Query/Table, NiceModal, shadcn UI, Vitest, Testing Library.

**Design spec:** [`docs/superpowers/specs/2026-07-14-org-role-management-design.md`](../specs/2026-07-14-org-role-management-design.md)

**Important dependency fact:** Installed Better Auth 1.6.14 has no `transferOwnership` endpoint. Ownership transfer must use the auth package's serializable Prisma transaction described below; do not call or type-cast a nonexistent Better Auth API.

---

## File Structure

### Auth package

- Create `packages/auth/src/org-roles/role-catalog.ts` — serializable labels, assignment flags, role ordering, rank helpers, and role normalization.
- Create `packages/auth/src/org-roles/role-catalog.test.ts` — catalog integrity and normalization boundaries.
- Create `packages/auth/src/org-roles/member-role-policy.ts` — pure actor/target hierarchy and assignment policy.
- Create `packages/auth/src/org-roles/member-role-policy.test.ts` — owner/admin/member policy matrix.
- Modify `packages/auth/src/org-roles/index.ts` — export browser-safe catalog and policy helpers.
- Create `packages/auth/src/member-role-management.ts` — server-only context, replace, bulk add/remove, invitation validation, and atomic ownership transfer.
- Create `packages/auth/src/member-role-management.test.ts` — mocked Better Auth/Prisma orchestration and transaction tests.
- Modify `packages/auth/package.json` — add the explicit `./member-role-management` server-only export and observability dependency.

### Dashboard data layer

- Modify `apps/dashboard/features/organization/data/org-types.ts` — schemas and typed result contracts for replace, bulk, invitation, and transfer operations.
- Modify `apps/dashboard/features/organization/data/org-types.test.ts` — schema boundaries.
- Modify `apps/dashboard/features/organization/data/org-actions.ts` — thin server adapters over the auth service.
- Create `apps/dashboard/features/organization/data/org-actions.test.ts` — validation, delegation, and safe error mapping.
- Modify `apps/dashboard/features/organization/data/org-permission-actions.ts` — return per-member management context, not only one boolean.
- Modify `apps/dashboard/features/organization/data/org-permission-actions.test.ts` — context delegation.

### Dashboard UI

- Create `apps/dashboard/features/organization/ui/member-management-eligibility.ts` — map policy codes to protected-state copy.
- Create `apps/dashboard/features/organization/ui/member-management-eligibility.test.ts` — stable protected-state labels.
- Create `apps/dashboard/features/organization/ui/members-list.tsx` — TanStack table state and responsive list composition.
- Create `apps/dashboard/features/organization/ui/members-list.test.tsx` — selection and partial-result behavior.
- Create `apps/dashboard/features/organization/ui/members-data-table.tsx` — desktop columns, badges, selection, and row menu.
- Create `apps/dashboard/features/organization/ui/members-mobile-list.tsx` — mobile cards with equivalent selection/actions.
- Create `apps/dashboard/features/organization/ui/members-bulk-actions.tsx` — standard selected-count action bar.
- Create `apps/dashboard/features/organization/ui/edit-member-roles-button-modal.tsx` — NiceModal individual complete-set editor.
- Create `apps/dashboard/features/organization/ui/edit-member-roles-button-modal.test.tsx` — options, owner exclusion, unknown-role blocking, refresh.
- Create `apps/dashboard/features/organization/ui/bulk-edit-member-roles-button-modal.tsx` — NiceModal add/remove flow and result summary.
- Create `apps/dashboard/features/organization/ui/bulk-edit-member-roles-button-modal.test.tsx` — operation intent and partial results.
- Create `apps/dashboard/features/organization/ui/invite-member-button-modal.tsx` — NiceModal multi-role invitation.
- Create `apps/dashboard/features/organization/ui/invite-member-button-modal.test.tsx` — multi-select validation.
- Create `apps/dashboard/features/organization/ui/transfer-ownership-confirm-dialog.tsx` — owner-only transfer confirmation.
- Create `apps/dashboard/features/organization/ui/transfer-ownership-confirm-dialog.test.tsx` — consequence copy and successful refresh.
- Modify `apps/dashboard/features/organization/ui/members-page-content.tsx` — page shell, context query, invite trigger, and new list.
- Delete `apps/dashboard/features/organization/ui/update-member-role-dialog.tsx` — replaced by NiceModal.
- Delete `apps/dashboard/features/organization/ui/invite-member-dialog.tsx` — replaced by NiceModal.
- Modify `apps/dashboard/vitest.config.ts` — use `happy-dom` for UI tests.
- Modify `apps/dashboard/package.json` and `pnpm-lock.yaml` — add Testing Library and `happy-dom` dev dependencies.
- Modify `packages/ui/src/components/data-table-select-column.tsx` — disable selection controls for rows TanStack marks ineligible.

### Verification/docs

- Modify `.ai/conventions/org-roles.md` — document catalog metadata, hierarchy, bulk semantics, multi-role invitations, and custom atomic ownership transfer.

No Prisma schema or migration file changes are expected.

## Critical Tests

- `packages/auth/src/org-roles/role-catalog.test.ts`: catalog keys exactly match `orgRoles`; `owner` is excluded from ordinary/invitation/bulk assignment; normalization rejects unknown/empty values, deduplicates, and registry-sorts; highest rank wins across combined roles.
- `packages/auth/src/org-roles/member-role-policy.test.ts`: owner manages admin/member; admin manages member but not admin/owner; self-edit, ordinary owner mutation, unknown persisted roles, and same/higher-rank targets fail closed.
- `packages/auth/src/member-role-management.test.ts`: explicit org scoping; immediate target reload; add/remove preserves unrelated roles; final-role removal fails; mixed bulk outcomes continue after failures; concurrency stays bounded; invitation assignment respects hierarchy; ownership transfer updates both members in one serializable transaction and gives a roleless former owner `admin`.
- `apps/dashboard/features/organization/data/org-types.test.ts`: malformed IDs, empty arrays, unknown roles, owner in ordinary payloads, oversized bulk selections, and invalid operations are rejected.
- `apps/dashboard/features/organization/data/org-actions.test.ts`: server actions forward explicit org IDs and headers, invitation forwards a role array, transfer delegates to the atomic service, and expected errors retain stable codes.
- `apps/dashboard/features/organization/ui/member-management-eligibility.test.ts`: policy codes produce correct editable/selectable state and protected-state copy.
- `apps/dashboard/features/organization/ui/members-list.test.tsx`: desktop/mobile share one selection state; protected rows cannot be selected; successful/unchanged bulk targets clear while failures remain selected.
- `apps/dashboard/features/organization/ui/edit-member-roles-button-modal.test.tsx`: catalog options initialize correctly, owner is absent, unknown roles block submit, and success invalidates members.
- `apps/dashboard/features/organization/ui/bulk-edit-member-roles-button-modal.test.tsx`: add/remove are explicit, partial results are summarized, and failed IDs are returned for retry.
- `apps/dashboard/features/organization/ui/invite-member-button-modal.test.tsx`: multiple roles are selectable, owner is absent, at least one role is required, and role arrays reach the action.
- `apps/dashboard/features/organization/ui/transfer-ownership-confirm-dialog.test.tsx`: consequences include former-owner fallback to admin, only eligible owners submit, and success refreshes context.

## Task 1: Add the Static Role Catalog and Pure Hierarchy Policy

**Files:**

- Create: `packages/auth/src/org-roles/role-catalog.test.ts`
- Create: `packages/auth/src/org-roles/role-catalog.ts`
- Create: `packages/auth/src/org-roles/member-role-policy.test.ts`
- Create: `packages/auth/src/org-roles/member-role-policy.ts`
- Modify: `packages/auth/src/org-roles/index.ts`

- [ ] **Step 1: Write failing catalog tests**

Cover exact key parity, assignment flags, unknown/empty rejection, deduplication,
ordering, and highest-rank behavior:

```ts
import { describe, expect, it } from "vitest";
import { orgRoles } from "./index";
import {
  ORG_ROLE_CATALOG,
  getHighestManagementRank,
  normalizeOrgRoleIds,
} from "./role-catalog";

describe("ORG_ROLE_CATALOG", () => {
  it("has one entry for every static Better Auth role", () => {
    expect(Object.keys(ORG_ROLE_CATALOG).sort()).toEqual(
      Object.keys(orgRoles).sort(),
    );
  });

  it("keeps owner out of ordinary assignment surfaces", () => {
    expect(ORG_ROLE_CATALOG.owner).toMatchObject({
      memberAssignable: false,
      invitationAssignable: false,
      bulkAssignable: false,
      ownership: true,
    });
  });

  it("normalizes, deduplicates, and registry-sorts roles", () => {
    expect(normalizeOrgRoleIds(["member", "admin", "member"])).toEqual([
      "admin",
      "member",
    ]);
  });

  it.each([[], ["unknown"]])("rejects invalid role sets: %j", (roles) => {
    expect(() => normalizeOrgRoleIds(roles)).toThrow();
  });

  it("uses the highest rank across combined roles", () => {
    expect(getHighestManagementRank(["member", "admin"])).toBe(20);
  });
});
```

- [ ] **Step 2: Run the catalog test and verify failure**

Run:

```bash
pnpm --filter @workspace/auth exec vitest run src/org-roles/role-catalog.test.ts
```

Expected: FAIL because `role-catalog.ts` does not exist.

- [ ] **Step 3: Implement the catalog**

Create the following complete public shape:

```ts
import type { OrgRoleId } from "./index";

export type OrgRoleMetadata = {
  label: string;
  description: string;
  order: number;
  managementRank: number;
  ownership: boolean;
  memberAssignable: boolean;
  invitationAssignable: boolean;
  bulkAssignable: boolean;
};

export const ORG_ROLE_CATALOG = {
  owner: {
    label: "Owner",
    description: "Full organization control, including ownership transfer.",
    order: 10,
    managementRank: 30,
    ownership: true,
    memberAssignable: false,
    invitationAssignable: false,
    bulkAssignable: false,
  },
  admin: {
    label: "Admin",
    description: "Manage organization settings, members, and product data.",
    order: 20,
    managementRank: 20,
    ownership: false,
    memberAssignable: true,
    invitationAssignable: true,
    bulkAssignable: true,
  },
  member: {
    label: "Member",
    description: "Use organization product features without administration.",
    order: 30,
    managementRank: 10,
    ownership: false,
    memberAssignable: true,
    invitationAssignable: true,
    bulkAssignable: true,
  },
} as const satisfies Record<OrgRoleId, OrgRoleMetadata>;

export class InvalidOrgRoleSetError extends Error {
  constructor(
    public readonly code: "EMPTY_ROLE_SET" | "UNKNOWN_ROLE",
    message: string,
  ) {
    super(message);
  }
}

export function isOrgRoleId(value: string): value is OrgRoleId {
  return Object.hasOwn(ORG_ROLE_CATALOG, value);
}

export function normalizeOrgRoleIds(values: readonly string[]): OrgRoleId[] {
  if (values.length === 0) {
    throw new InvalidOrgRoleSetError("EMPTY_ROLE_SET", "Select at least one role.");
  }
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.some((value) => !isOrgRoleId(value))) {
    throw new InvalidOrgRoleSetError("UNKNOWN_ROLE", "Role configuration is out of date.");
  }
  return (unique as OrgRoleId[]).sort(
    (a, b) => ORG_ROLE_CATALOG[a].order - ORG_ROLE_CATALOG[b].order,
  );
}

export function getHighestManagementRank(values: readonly string[]): number {
  const roles = normalizeOrgRoleIds(values);
  return Math.max(...roles.map((role) => ORG_ROLE_CATALOG[role].managementRank));
}

export function hasOwnershipRole(values: readonly string[]): boolean {
  return normalizeOrgRoleIds(values).some((role) => ORG_ROLE_CATALOG[role].ownership);
}

export const MEMBER_ASSIGNABLE_ORG_ROLE_IDS = Object.keys(ORG_ROLE_CATALOG).filter(
  (role): role is OrgRoleId =>
    isOrgRoleId(role) && ORG_ROLE_CATALOG[role].memberAssignable,
);

export const INVITATION_ASSIGNABLE_ORG_ROLE_IDS = Object.keys(
  ORG_ROLE_CATALOG,
).filter(
  (role): role is OrgRoleId =>
    isOrgRoleId(role) && ORG_ROLE_CATALOG[role].invitationAssignable,
);

export const BULK_ASSIGNABLE_ORG_ROLE_IDS = Object.keys(ORG_ROLE_CATALOG).filter(
  (role): role is OrgRoleId =>
    isOrgRoleId(role) && ORG_ROLE_CATALOG[role].bulkAssignable,
);
```

Keep the `OrgRoleId` import type-only. TypeScript erases it at runtime, so
`org-roles/index.ts` can export the catalog without creating a value cycle.

- [ ] **Step 4: Write failing hierarchy-policy tests**

Use table-driven cases:

```ts
import { describe, expect, it } from "vitest";
import {
  evaluateMemberManagement,
  evaluateOwnershipTransfer,
  evaluateRoleAssignment,
} from "./member-role-policy";

describe("evaluateMemberManagement", () => {
  it.each([
    ["owner", "admin", true, null],
    ["owner", "member", true, null],
    ["admin", "member", true, null],
    ["admin", "admin", false, "SAME_OR_HIGHER_RANK"],
    ["admin", "owner", false, "OWNER_PROTECTED"],
    ["member", "member", false, "MISSING_PERMISSION"],
  ] as const)(
    "%s managing %s",
    (actorRole, targetRole, allowed, reason) => {
      expect(
        evaluateMemberManagement({
          actorUserId: "actor",
          actorRoles: [actorRole],
          targetUserId: "target",
          targetRoles: [targetRole],
          hasMemberUpdatePermission: actorRole !== "member",
        }),
      ).toEqual({ allowed, reason });
    },
  );

  it("rejects self-management", () => {
    expect(
      evaluateMemberManagement({
        actorUserId: "same",
        actorRoles: ["owner"],
        targetUserId: "same",
        targetRoles: ["member"],
        hasMemberUpdatePermission: true,
      }),
    ).toEqual({ allowed: false, reason: "SELF" });
  });
});

describe("evaluateRoleAssignment", () => {
  it("allows owner to assign admin and admin to assign member", () => {
    expect(evaluateRoleAssignment(["owner"], ["admin"])).toEqual({
      allowed: true,
      reason: null,
    });
    expect(evaluateRoleAssignment(["admin"], ["member"])).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it("prevents admin from assigning admin or owner", () => {
    expect(evaluateRoleAssignment(["admin"], ["admin"]).allowed).toBe(false);
    expect(evaluateRoleAssignment(["admin"], ["owner"]).allowed).toBe(false);
  });
});

describe("evaluateOwnershipTransfer", () => {
  it("allows only an owner to transfer to a different non-owner", () => {
    expect(
      evaluateOwnershipTransfer({
        actorUserId: "owner",
        actorRoles: ["owner"],
        targetUserId: "member",
        targetRoles: ["member"],
      }),
    ).toEqual({ allowed: true, reason: null });
    expect(
      evaluateOwnershipTransfer({
        actorUserId: "admin",
        actorRoles: ["admin"],
        targetUserId: "member",
        targetRoles: ["member"],
      }).allowed,
    ).toBe(false);
  });
});
```

- [ ] **Step 5: Implement pure policy functions**

```ts
import {
  getHighestManagementRank,
  hasOwnershipRole,
  normalizeOrgRoleIds,
} from "./role-catalog";

export type MemberManagementReason =
  | "MISSING_PERMISSION"
  | "SELF"
  | "OWNER_PROTECTED"
  | "SAME_OR_HIGHER_RANK"
  | "UNKNOWN_ROLE";

export type MemberManagementDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: MemberManagementReason };

export function evaluateMemberManagement(input: {
  actorUserId: string;
  actorRoles: readonly string[];
  targetUserId: string;
  targetRoles: readonly string[];
  hasMemberUpdatePermission: boolean;
}): MemberManagementDecision {
  if (!input.hasMemberUpdatePermission) {
    return { allowed: false, reason: "MISSING_PERMISSION" };
  }
  if (input.actorUserId === input.targetUserId) {
    return { allowed: false, reason: "SELF" };
  }
  try {
    normalizeOrgRoleIds(input.actorRoles);
    normalizeOrgRoleIds(input.targetRoles);
  } catch {
    return { allowed: false, reason: "UNKNOWN_ROLE" };
  }
  if (hasOwnershipRole(input.targetRoles)) {
    return { allowed: false, reason: "OWNER_PROTECTED" };
  }
  if (
    getHighestManagementRank(input.actorRoles) <=
    getHighestManagementRank(input.targetRoles)
  ) {
    return { allowed: false, reason: "SAME_OR_HIGHER_RANK" };
  }
  return { allowed: true, reason: null };
}

export function evaluateRoleAssignment(
  actorRoles: readonly string[],
  assignedRoles: readonly string[],
): MemberManagementDecision {
  try {
    if (hasOwnershipRole(assignedRoles)) {
      return { allowed: false, reason: "OWNER_PROTECTED" };
    }
    return getHighestManagementRank(actorRoles) >
      getHighestManagementRank(assignedRoles)
      ? { allowed: true, reason: null }
      : { allowed: false, reason: "SAME_OR_HIGHER_RANK" };
  } catch {
    return { allowed: false, reason: "UNKNOWN_ROLE" };
  }
}

export function evaluateOwnershipTransfer(input: {
  actorUserId: string;
  actorRoles: readonly string[];
  targetUserId: string;
  targetRoles: readonly string[];
}): MemberManagementDecision {
  try {
    normalizeOrgRoleIds(input.actorRoles);
    normalizeOrgRoleIds(input.targetRoles);
  } catch {
    return { allowed: false, reason: "UNKNOWN_ROLE" };
  }
  if (!hasOwnershipRole(input.actorRoles)) {
    return { allowed: false, reason: "MISSING_PERMISSION" };
  }
  if (input.actorUserId === input.targetUserId) {
    return { allowed: false, reason: "SELF" };
  }
  if (hasOwnershipRole(input.targetRoles)) {
    return { allowed: false, reason: "OWNER_PROTECTED" };
  }
  return { allowed: true, reason: null };
}
```

- [ ] **Step 6: Export browser-safe helpers and run tests**

Add catalog/policy exports to `org-roles/index.ts`, then run:

```bash
pnpm --filter @workspace/auth exec vitest run src/org-roles/role-catalog.test.ts src/org-roles/member-role-policy.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/auth/src/org-roles
git commit -m "feat(auth): define organization role management policy"
```

## Task 2: Build the Server-Only Member Role Management Service

**Files:**

- Create: `packages/auth/src/member-role-management.test.ts`
- Create: `packages/auth/src/member-role-management.ts`
- Modify: `packages/auth/package.json`

- [ ] **Step 1: Write failing service tests for context and ordinary updates**

Mock `./auth` and `@workspace/database`. Prove:

```ts
it("scopes actor and target lookups to the explicit organization", async () => {
  await replaceMemberRoles({
    headers: new Headers(),
    organizationId: "org_1",
    memberId: "member_2",
    roles: ["member"],
  });

  expect(mockPrisma.member.findFirst).toHaveBeenCalledWith({
    where: { organizationId: "org_1", userId: "user_actor" },
  });
  expect(mockPrisma.member.findFirst).toHaveBeenCalledWith({
    where: { id: "member_2", organizationId: "org_1" },
  });
});

it("reloads the target immediately before writing", async () => {
  expect(mockPrisma.member.findFirst).toHaveBeenCalledBefore(
    mockUpdateMemberRole,
  );
});

it("preserves unrelated roles for add/remove", async () => {
  mockTarget.role = "admin,member";
  await mutateMemberRoles({
    headers: new Headers(),
    organizationId: "org_1",
    memberIds: ["member_2"],
    operation: "remove",
    roles: ["member"],
  });
  expect(mockUpdateMemberRole).toHaveBeenCalledWith(
    expect.objectContaining({
      body: expect.objectContaining({ role: ["admin"] }),
    }),
  );
});

it("rejects removal of the final role", async () => {
  mockTarget.role = "member";
  const result = await mutateMemberRoles({
    headers: new Headers(),
    organizationId: "org_1",
    memberIds: ["member_2"],
    operation: "remove",
    roles: ["member"],
  });
  expect(result.outcomes).toEqual([
    expect.objectContaining({ memberId: "member_2", status: "failed", code: "EMPTY_ROLE_SET" }),
  ]);
});
```

- [ ] **Step 2: Run tests and verify failure**

```bash
pnpm --filter @workspace/auth exec vitest run src/member-role-management.test.ts
```

Expected: FAIL because the service does not exist.

- [ ] **Step 3: Implement service contracts and errors**

Use these exact public contracts:

```ts
export type MemberRoleFailureCode =
  | "UNAUTHENTICATED"
  | "NOT_A_MEMBER"
  | "MISSING_PERMISSION"
  | "SELF"
  | "OWNER_PROTECTED"
  | "SAME_OR_HIGHER_RANK"
  | "UNKNOWN_ROLE"
  | "EMPTY_ROLE_SET"
  | "MEMBER_NOT_FOUND"
  | "UPDATE_FAILED";

export type MemberRoleOutcome =
  | { memberId: string; status: "updated"; roles: string[] }
  | { memberId: string; status: "unchanged"; roles: string[] }
  | {
      memberId: string;
      status: "failed";
      code: MemberRoleFailureCode;
      message: string;
    };

export type MemberManagementContext = {
  canManageMembers: boolean;
  actorRoles: string[];
  members: Record<
    string,
    {
      allowed: boolean;
      reason: MemberManagementReason | null;
      canTransferOwnership: boolean;
    }
  >;
};

export class MemberRoleManagementError extends Error {
  constructor(
    public readonly code: MemberRoleFailureCode,
    message: string,
  ) {
    super(message);
  }
}
```

Implement one private `loadActorContext(headers, organizationId)` that calls
`auth.api.getSession`, `auth.api.hasPermission` with the explicit org ID, and
queries the actor's `Member` row. Never infer authority only from the active org.
Import `captureException` from `@workspace/observability/capture` for unexpected
service failures. Log only operation name, organization ID, and member ID; never
attach email addresses or role payloads.

- [ ] **Step 4: Implement context and one-target mutation**

`getMemberManagementContext` loads the requested members and evaluates each with
`evaluateMemberManagement` and `evaluateOwnershipTransfer`.
`replaceMemberRoles` must:

1. normalize requested roles;
2. reject any role not marked `memberAssignable`;
3. reload the target by both ID and organization;
4. evaluate hierarchy;
5. call `evaluateRoleAssignment(actor.roles, requestedRoles)` so an admin cannot
   promote a member to admin;
6. reject unknown persisted roles;
7. call `auth.api.updateMemberRole` with `headers`, explicit `organizationId`,
   target ID, and the normalized array.

Return `unchanged` when normalized sets match.

- [ ] **Step 5: Implement bounded best-effort bulk add/remove**

Use a local bounded mapper with concurrency `4`:

```ts
async function mapWithConcurrency<T, R>(
  values: readonly T[],
  limit: number,
  worker: (value: T) => Promise<R>,
): Promise<R[]> {
  const output = new Array<R>(values.length);
  let nextIndex = 0;
  async function runWorker() {
    while (nextIndex < values.length) {
      const index = nextIndex++;
      output[index] = await worker(values[index]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, values.length) }, () => runWorker()),
  );
  return output;
}
```

For each target, reload current roles and compute:

```ts
const nextRoles =
  operation === "add"
    ? normalizeOrgRoleIds([...currentRoles, ...requestedRoles])
    : normalizeOrgRoleIds(
        currentRoles.filter((role) => !requestedRoles.includes(role)),
      );
```

Evaluate the resulting complete role set with
`evaluateRoleAssignment(actor.roles, nextRoles)` before writing. This is
required for bulk add: an admin may add ordinary member/functional roles but may
not promote selected members to admin.

Catch expected errors per target and return `failed`; do not reject the whole
bulk request. For unexpected errors, call `captureException(error, {
operation: "member-role-bulk", organizationId, memberId })` before returning the
generic `UPDATE_FAILED` result. Validate all requested roles before starting
workers.

- [ ] **Step 6: Test mixed outcomes and concurrency**

Add tests where one update rejects and later targets still finish. Instrument
the mocked update function with an active-call counter and assert the observed
maximum is `<= 4`.

- [ ] **Step 7: Add the server-only package export**

Add:

```json
"./member-role-management": "./src/member-role-management.ts"
```

Also add:

```json
"@workspace/observability": "workspace:*"
```

Do not re-export the service from `packages/auth/src/index.ts` or
`org-roles/index.ts`; keeping a separate subpath prevents server code from
entering client bundles.

- [ ] **Step 8: Refresh the lockfile**

```bash
pnpm install
```

Expected: `pnpm-lock.yaml` records the auth package's workspace dependency.

- [ ] **Step 9: Run targeted tests and type-check**

```bash
pnpm --filter @workspace/auth exec vitest run src/member-role-management.test.ts
pnpm --filter @workspace/auth type-check
```

Expected: PASS.

- [ ] **Step 10: Commit**

```bash
git add packages/auth/src/member-role-management.ts packages/auth/src/member-role-management.test.ts packages/auth/package.json pnpm-lock.yaml
git commit -m "feat(auth): enforce member role management hierarchy"
```

## Task 3: Add Multi-Role Invitations and Atomic Ownership Transfer

**Files:**

- Modify: `packages/auth/src/member-role-management.test.ts`
- Modify: `packages/auth/src/member-role-management.ts`

- [ ] **Step 1: Write failing invitation assignment tests**

Test owner inviting `["admin", "member"]`, admin inviting `["member"]`, admin
being denied when inviting `["admin"]`, and every invitation rejecting `owner`.
Verify `auth.api.createInvitation` receives the role array and explicit org ID.

- [ ] **Step 2: Implement `inviteMemberWithRoles`**

Add:

```ts
export async function inviteMemberWithRoles(input: {
  headers: Headers;
  organizationId: string;
  email: string;
  roles: readonly string[];
}) {
  const actor = await loadActorContext(input.headers, input.organizationId);
  const roles = normalizeOrgRoleIds(input.roles);
  if (
    roles.some(
      (role) => !ORG_ROLE_CATALOG[role].invitationAssignable,
    )
  ) {
    throw new MemberRoleManagementError(
      "OWNER_PROTECTED",
      "Ownership cannot be assigned by invitation.",
    );
  }
  const assignment = evaluateRoleAssignment(actor.roles, roles);
  if (!assignment.allowed) {
    throw new MemberRoleManagementError(
      assignment.reason,
      "You cannot assign one or more selected roles.",
    );
  }
  return auth.api.createInvitation({
    headers: input.headers,
    body: {
      organizationId: input.organizationId,
      email: input.email,
      role: roles,
    },
  });
}
```

The actor loader must additionally verify `{ invitation: ["create"] }` for this
operation rather than reusing only `member:update`.

- [ ] **Step 3: Write failing ownership-transfer transaction tests**

Prove:

- only an actor with exact parsed `owner` role may transfer;
- self-transfer and target-already-owner fail;
- actor/target must belong to the explicit organization;
- unknown persisted role fields fail closed;
- target keeps existing roles and gains `owner`;
- old owner keeps non-owner roles;
- owner-only actor becomes `admin`;
- persisted multiple-owner drift fails closed;
- both updates occur inside one `$transaction` configured with
  `Prisma.TransactionIsolationLevel.Serializable`;
- if either update fails, the transaction rejects and no success is returned.

- [ ] **Step 4: Implement atomic `transferOrganizationOwnership`**

Use Prisma directly because Better Auth 1.6.14 has no ownership-transfer API:

```ts
export async function transferOrganizationOwnership(input: {
  headers: Headers;
  organizationId: string;
  targetMemberId: string;
}): Promise<{ previousOwnerRoles: string[]; newOwnerRoles: string[] }> {
  const session = await requireSession(input.headers);
  return prisma.$transaction(
    async (tx) => {
      const actor = await tx.member.findFirst({
        where: {
          organizationId: input.organizationId,
          userId: session.user.id,
        },
      });
      const target = await tx.member.findFirst({
        where: {
          id: input.targetMemberId,
          organizationId: input.organizationId,
        },
      });
      if (!actor || !target) {
        throw new MemberRoleManagementError(
          "MEMBER_NOT_FOUND",
          "Member not found.",
        );
      }
      const actorRoles = normalizeOrgRoleIds(parseOrgRoles(actor.role));
      const targetRoles = normalizeOrgRoleIds(parseOrgRoles(target.role));
      const organizationMembers = await tx.member.findMany({
        where: { organizationId: input.organizationId },
        select: { id: true, role: true },
      });
      const otherOwners = organizationMembers.filter(
        (member) =>
          member.id !== actor.id &&
          hasOwnershipRole(normalizeOrgRoleIds(parseOrgRoles(member.role))),
      );
      if (otherOwners.length > 0) {
        throw new MemberRoleManagementError(
          "OWNER_PROTECTED",
          "Resolve multiple-owner role data before transferring ownership.",
        );
      }
      if (!hasOwnershipRole(actorRoles)) {
        throw new MemberRoleManagementError(
          "MISSING_PERMISSION",
          "Only the current owner can transfer ownership.",
        );
      }
      if (actor.userId === target.userId || hasOwnershipRole(targetRoles)) {
        throw new MemberRoleManagementError(
          "OWNER_PROTECTED",
          "Select a different non-owner member.",
        );
      }
      const previousOwnerRoles = normalizeOrgRoleIds(
        actorRoles.filter((role) => role !== "owner").length > 0
          ? actorRoles.filter((role) => role !== "owner")
          : ["admin"],
      );
      const newOwnerRoles = normalizeOrgRoleIds([...targetRoles, "owner"]);
      await tx.member.update({
        where: { id: actor.id },
        data: { role: previousOwnerRoles.join(",") },
      });
      await tx.member.update({
        where: { id: target.id },
        data: { role: newOwnerRoles.join(",") },
      });
      return { previousOwnerRoles, newOwnerRoles };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
```

- [ ] **Step 5: Run service tests**

```bash
pnpm --filter @workspace/auth exec vitest run src/member-role-management.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add packages/auth/src/member-role-management.ts packages/auth/src/member-role-management.test.ts
git commit -m "feat(auth): add role invitations and ownership transfer"
```

## Task 4: Replace Dashboard Mutation Paths with Typed Server Actions

**Files:**

- Modify: `apps/dashboard/features/organization/data/org-types.test.ts`
- Modify: `apps/dashboard/features/organization/data/org-types.ts`
- Create: `apps/dashboard/features/organization/data/org-actions.test.ts`
- Modify: `apps/dashboard/features/organization/data/org-actions.ts`
- Modify: `apps/dashboard/features/organization/data/org-permission-actions.test.ts`
- Modify: `apps/dashboard/features/organization/data/org-permission-actions.ts`

- [ ] **Step 1: Write failing schema tests**

Add schemas with these payloads:

```ts
{ organizationId, memberId, roles: string[] } // replace
{ organizationId, memberIds: string[], operation: "add" | "remove", roles: string[] } // bulk
{ organizationId, email, roles: string[] } // invite
{ organizationId, targetMemberId } // transfer
```

Assert `.min(1)` roles/targets, `.max(100)` bulk targets, valid email, unknown
role rejection, and ordinary owner-role rejection.

- [ ] **Step 2: Implement schemas with registry predicates**

Do not duplicate a Zod enum:

```ts
const memberAssignableRoleSchema = z
  .string()
  .refine(
    (value) =>
      isOrgRoleId(value) && ORG_ROLE_CATALOG[value].memberAssignable,
    "Role cannot be assigned here",
  );

const invitationAssignableRoleSchema = z
  .string()
  .refine(
    (value) =>
      isOrgRoleId(value) && ORG_ROLE_CATALOG[value].invitationAssignable,
    "Role cannot be assigned by invitation",
  );

const bulkAssignableRoleSchema = z
  .string()
  .refine(
    (value) =>
      isOrgRoleId(value) && ORG_ROLE_CATALOG[value].bulkAssignable,
    "Role cannot be changed in bulk",
  );

export const replaceMemberRolesSchema = z.object({
  organizationId: z.string().min(1),
  memberId: z.string().min(1),
  roles: z.array(memberAssignableRoleSchema).min(1),
});

export const bulkMemberRolesSchema = z.object({
  organizationId: z.string().min(1),
  memberIds: z.array(z.string().min(1)).min(1).max(100),
  operation: z.enum(["add", "remove"]),
  roles: z.array(bulkAssignableRoleSchema).min(1),
});

export const inviteMemberSchema = z.object({
  organizationId: z.string().min(1),
  email: z.string().email(),
  roles: z.array(invitationAssignableRoleSchema).min(1),
});

export const transferOwnershipSchema = z.object({
  organizationId: z.string().min(1),
  targetMemberId: z.string().min(1),
});
```

- [ ] **Step 3: Write failing action tests**

Mock `@workspace/auth/member-role-management` and `next/headers`. Verify each
action parses input, passes `await headers()`, keeps explicit org ID, and maps
`MemberRoleManagementError` to:

```ts
type MemberRoleActionResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: MemberRoleFailureCode | "INVALID_INPUT"; message: string };
    };
```

Unexpected exceptions return `UPDATE_FAILED` with generic copy.

- [ ] **Step 4: Implement thin server actions**

Export:

```ts
replaceMemberRolesAction
bulkMemberRolesAction
inviteMemberAction
transferOwnershipAction
```

Each action follows this structure:

```ts
export async function replaceMemberRolesAction(
  input: unknown,
): Promise<MemberRoleActionResult<MemberRoleOutcome>> {
  const parsed = replaceMemberRolesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: { code: "INVALID_INPUT", message: "Check the selected roles." },
    };
  }
  try {
    return {
      success: true,
      data: await replaceMemberRoles({
        ...parsed.data,
        headers: await headers(),
      }),
    };
  } catch (error) {
    return toMemberRoleActionError(error);
  }
}
```

Remove the stale single-role `updateMemberRoleAction`. Keep unrelated create,
remove, and cancel actions unless their callers are migrated in this plan.

- [ ] **Step 5: Expand management-context action**

Replace the boolean-only action with:

```ts
export async function getMemberManagementContextAction(
  organizationId: string,
  memberIds: string[],
) {
  return getMemberManagementContext({
    headers: await headers(),
    organizationId,
    memberIds,
  });
}
```

Keep `getApiKeyManageContextAction` unchanged.

- [ ] **Step 6: Run data-layer tests**

```bash
pnpm --filter @apps/dashboard exec vitest run features/organization/data/org-types.test.ts features/organization/data/org-actions.test.ts features/organization/data/org-permission-actions.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/features/organization/data
git commit -m "feat(dashboard): add guarded organization role actions"
```

## Task 5: Add Dashboard Component-Test Support

**Files:**

- Modify: `apps/dashboard/package.json`
- Modify: `apps/dashboard/vitest.config.ts`
- Modify: `pnpm-lock.yaml`

- [ ] **Step 1: Add the UI test dependencies**

This command changes dependencies and therefore requires developer confirmation
when the plan is executed:

```bash
pnpm add -D --filter @apps/dashboard @testing-library/react @testing-library/user-event happy-dom
```

Expected: dashboard dev dependencies and lockfile update.

- [ ] **Step 2: Configure `happy-dom`**

Change dashboard Vitest environment:

```ts
test: {
  environment: "happy-dom",
  exclude: [...configDefaults.exclude, "e2e/**"],
},
```

Keep the existing JSX transform and `@` alias.

- [ ] **Step 3: Add one smoke assertion in the first UI test**

Create `member-management-eligibility.test.ts` in Task 6 and run it here to
prove the config resolves TSX-adjacent modules:

```bash
pnpm --filter @apps/dashboard exec vitest run features/organization/ui/member-management-eligibility.test.ts
```

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add apps/dashboard/package.json apps/dashboard/vitest.config.ts pnpm-lock.yaml
git commit -m "test(dashboard): add component test environment"
```

## Task 6: Build Responsive Member Selection and Row Actions

**Files:**

- Create: `apps/dashboard/features/organization/ui/member-management-eligibility.test.ts`
- Create: `apps/dashboard/features/organization/ui/member-management-eligibility.ts`
- Create: `apps/dashboard/features/organization/ui/members-list.test.tsx`
- Create: `apps/dashboard/features/organization/ui/members-list.tsx`
- Create: `apps/dashboard/features/organization/ui/members-data-table.tsx`
- Create: `apps/dashboard/features/organization/ui/members-mobile-list.tsx`
- Create: `apps/dashboard/features/organization/ui/members-bulk-actions.tsx`
- Modify: `packages/ui/src/components/data-table-select-column.tsx`

- [ ] **Step 1: Test protected-state copy**

```ts
import { describe, expect, it } from "vitest";
import { getMemberManagementPresentation } from "./member-management-eligibility";

describe("getMemberManagementPresentation", () => {
  it.each([
    [null, true, null],
    ["SELF", false, "You cannot edit your own roles."],
    ["OWNER_PROTECTED", false, "Ownership changes use Transfer ownership."],
    ["SAME_OR_HIGHER_RANK", false, "Only owners can manage admins."],
    ["MISSING_PERMISSION", false, "You do not have permission to manage roles."],
    ["UNKNOWN_ROLE", false, "Role configuration must be repaired before editing."],
  ] as const)("%s", (reason, selectable, message) => {
    expect(getMemberManagementPresentation(reason)).toEqual({
      editable: selectable,
      selectable,
      protectedMessage: message,
    });
  });
});
```

Implement the direct exhaustive mapping with a `never` check.

- [ ] **Step 2: Write failing list selection tests**

Render `MembersList` with one allowed and one protected member. Assert:

- desktop and mobile checkboxes reflect the same TanStack selection;
- protected checkbox is disabled;
- selecting an allowed member shows `1 selected`;
- invoking the supplied bulk completion callback with one failed ID clears only
  successful/unchanged IDs.

- [ ] **Step 3: Implement the list shell**

Use one `RowSelectionState` and no pagination:

```ts
const table = useReactTable<MemberRow>({
  data: members,
  columns,
  state: { rowSelection },
  getRowId: (row) => row.id,
  enableRowSelection: (row) => row.original.management.allowed,
  onRowSelectionChange: setRowSelection,
  getCoreRowModel: getCoreRowModel(),
  meta: { onEditRoles, onTransferOwnership, onRemove },
});
```

Render `ResponsiveDataView` with `MembersMobileList` and `MembersDataTable`.
Render `MembersBulkActions` when `getDataTableSelectedRowCount(table) > 0`.
Provide a callback that removes all IDs except failed IDs from selection after a
bulk result.

- [ ] **Step 4: Make the shared selection column honor row eligibility**

Add the missing disabled state to the shared cell checkbox:

```tsx
<Checkbox
  aria-label="Select row"
  checked={row.getIsSelected()}
  disabled={!row.getCanSelect()}
  onCheckedChange={(value) => row.toggleSelected(!!value)}
  onClick={(event) => event.stopPropagation()}
/>
```

The header already delegates selection to TanStack, which skips ineligible
rows.

- [ ] **Step 5: Implement desktop columns**

Use `createDataTableSelectColumn`, existing Avatar/Badge primitives, `formatDate`
from `@workspace/common`, and a row action dropdown. Show:

- **Edit roles** only when `management.allowed`;
- **Transfer ownership** only when `canTransferOwnership`;
- **Remove** using existing behavior;
- protected copy in the actions cell or an accessible tooltip when no role
  action is available.

Do not import `lucide-react`; use `@workspace/ui/components/icon-for`.

- [ ] **Step 6: Implement mobile cards**

Mirror desktop selection and actions. Disable the checkbox when
`!row.getCanSelect()`, render role badges, email, `formatDate(createdAt)`, and
protected-state copy. Stop checkbox/menu propagation.

- [ ] **Step 7: Implement the bulk action bar**

Use `DataTableBulkActions` with **Add roles** and **Remove roles** menu items.
Collect selected IDs from `table.getState().rowSelection` and open the bulk
NiceModal implemented in Task 7.

- [ ] **Step 8: Run UI tests**

```bash
pnpm --filter @apps/dashboard exec vitest run features/organization/ui/member-management-eligibility.test.ts features/organization/ui/members-list.test.tsx
```

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add apps/dashboard/features/organization/ui/member-management-eligibility* apps/dashboard/features/organization/ui/members-list* apps/dashboard/features/organization/ui/members-data-table.tsx apps/dashboard/features/organization/ui/members-mobile-list.tsx apps/dashboard/features/organization/ui/members-bulk-actions.tsx packages/ui/src/components/data-table-select-column.tsx
git commit -m "feat(dashboard): add responsive member role selection"
```

## Task 7: Add Individual and Bulk Role Modals

**Files:**

- Create: `apps/dashboard/features/organization/ui/edit-member-roles-button-modal.test.tsx`
- Create: `apps/dashboard/features/organization/ui/edit-member-roles-button-modal.tsx`
- Create: `apps/dashboard/features/organization/ui/bulk-edit-member-roles-button-modal.test.tsx`
- Create: `apps/dashboard/features/organization/ui/bulk-edit-member-roles-button-modal.tsx`
- Delete: `apps/dashboard/features/organization/ui/update-member-role-dialog.tsx`

- [ ] **Step 1: Write failing individual-modal tests**

Mock `replaceMemberRolesAction` and TanStack Query. Assert catalog-derived
checkboxes show admin/member but not owner, initialize from current roles,
disable submit for empty/unknown sets, display typed errors, and invalidate:

```ts
["members", orgSlug]
["member-management-context", organizationId]
```

- [ ] **Step 2: Implement the individual NiceModal**

Use:

```ts
export const EditMemberRolesButtonModal = NiceModal.create(
  ({ organizationId, orgSlug, memberId, memberName, currentRoles }: Props) => {
    const modal = useModal();
    // checkbox state from MEMBER_ASSIGNABLE_ORG_ROLE_IDS
    // submit replaceMemberRolesAction(...)
    // modal.resolve(result.data), invalidate, modal.hide()
  },
);
```

Use `Dialog`, not `DialogTrigger`. Unknown current roles render read-only badges
and disable submit with the repair message.

- [ ] **Step 3: Write failing bulk-modal tests**

For both `add` and `remove`, assert the title and confirmation copy identify the
operation; owner is absent; submitted member IDs and role arrays are exact;
updated/unchanged/failed counts render; `modal.resolve({ failedMemberIds })`
preserves retry IDs.

- [ ] **Step 4: Implement the bulk NiceModal**

Call `bulkMemberRolesAction`. Before submission show selected count and role
checkboxes. After submission keep the dialog open when failures exist and show
member names by mapping result IDs to the supplied selected-member summaries.
Allow closing after reviewing results.

- [ ] **Step 5: Wire row and bulk triggers**

In row actions:

```ts
void NiceModal.show(EditMemberRolesButtonModal, {
  organizationId,
  orgSlug,
  memberId: member.id,
  memberName: member.user.name,
  currentRoles: member.roles,
});
```

In bulk actions, await the modal result and update selection using its failed
IDs.

- [ ] **Step 6: Remove the old controlled dialog and run tests**

```bash
pnpm --filter @apps/dashboard exec vitest run features/organization/ui/edit-member-roles-button-modal.test.tsx features/organization/ui/bulk-edit-member-roles-button-modal.test.tsx features/organization/ui/members-list.test.tsx
```

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add apps/dashboard/features/organization/ui
git commit -m "feat(dashboard): add individual and bulk role modals"
```

## Task 8: Add Multi-Role Invitations and Ownership Transfer UI

**Files:**

- Create: `apps/dashboard/features/organization/ui/invite-member-button-modal.test.tsx`
- Create: `apps/dashboard/features/organization/ui/invite-member-button-modal.tsx`
- Create: `apps/dashboard/features/organization/ui/transfer-ownership-confirm-dialog.test.tsx`
- Create: `apps/dashboard/features/organization/ui/transfer-ownership-confirm-dialog.tsx`
- Delete: `apps/dashboard/features/organization/ui/invite-member-dialog.tsx`

- [ ] **Step 1: Write failing invitation modal tests**

Assert multiple catalog-derived roles may be selected, owner is absent, empty
selection blocks submission, action receives `roles: string[]`, successful
submission invalidates `["organization", orgSlug]`, and the modal closes.

- [ ] **Step 2: Implement the invitation NiceModal**

Keep React Hook Form/Zod, changing `role` to `roles`. Open it from an ordinary
button:

```ts
void NiceModal.show(InviteMemberButtonModal, {
  organizationId,
  orgSlug,
});
```

The modal calls `inviteMemberAction`; do not call `authClient` directly.

- [ ] **Step 3: Write failing ownership confirmation tests**

Assert exact consequences:

- target gains owner while retaining roles;
- current owner loses owner;
- current owner becomes admin only if owner was their sole role.

Verify target name is present, cancellation does not call the action, success
invalidates members/context, and server error copy remains visible.

- [ ] **Step 4: Implement ownership confirmation**

Use `NiceModal.create` + `AlertDialog`. Submit:

```ts
transferOwnershipAction({
  organizationId,
  targetMemberId,
});
```

On success invalidate organization, members, and management-context queries,
resolve `true`, and hide. Do not update role badges optimistically.

- [ ] **Step 5: Run modal tests**

```bash
pnpm --filter @apps/dashboard exec vitest run features/organization/ui/invite-member-button-modal.test.tsx features/organization/ui/transfer-ownership-confirm-dialog.test.tsx
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/features/organization/ui
git commit -m "feat(dashboard): add role invitations and ownership transfer"
```

## Task 9: Integrate the Members Page and Remove Drift

**Files:**

- Modify: `apps/dashboard/features/organization/ui/members-page-content.tsx`
- Modify: `apps/dashboard/features/organization/ui/org-provider.tsx` only if its exported member type must be shared
- Modify: `apps/dashboard/features/organization/data/org-permission-actions.test.ts`

- [ ] **Step 1: Replace the old page-local dialog state**

`MembersPageContent` should retain only page data and management-context query.
Remove `roleDialog`, `ownerExistsElsewhere`, and controlled role/invite dialog
instances.

- [ ] **Step 2: Query per-member management context**

Use a stable sorted member-ID key:

```ts
const memberIds = useMemo(
  () => members.map((member) => member.id).sort(),
  [members],
);
const { data: managementContext } = useQuery({
  queryKey: ["member-management-context", organization?.id, memberIds],
  queryFn: () =>
    getMemberManagementContextAction(organization!.id, memberIds),
  enabled: Boolean(organization?.id) && memberIds.length > 0,
});
```

Avoid an unstable array key recreated every render.

- [ ] **Step 3: Render the new invite button and list**

The header button opens `InviteMemberButtonModal`. Pass members decorated with
their server-provided management decisions to `MembersList`. Keep pending
invitations and existing removal behavior.

- [ ] **Step 4: Use project date formatting**

Replace every touched `toLocaleDateString()` in Members/Pending Invitations with
`formatDate()` from `@workspace/common`, following
`.ai/conventions/format-date.md`.

- [ ] **Step 5: Run organization tests and type-check**

```bash
pnpm --filter @apps/dashboard exec vitest run features/organization
pnpm --filter @apps/dashboard type-check
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/dashboard/features/organization
git commit -m "feat(dashboard): integrate organization role management"
```

## Task 10: Update Guidance and Complete Verification

**Files:**

- Modify: `.ai/conventions/org-roles.md`

- [ ] **Step 1: Update the org-role convention**

Document:

- catalog metadata is the UI option source;
- rank helpers enforce actor/target hierarchy;
- owner is never assigned through ordinary role mutation or invitation;
- bulk add/remove is best-effort and preserves unrelated roles;
- multi-role invitations remain CSV in the existing `Invitation.role` string;
- Better Auth 1.6.14 lacks ownership transfer;
- the auth service transfers ownership atomically and gives an otherwise
  roleless former owner `admin`;
- no schema migration is required.

- [ ] **Step 2: Record why no role-management E2E is added**

The current E2E saved state authenticates only `user@example.com`, an ordinary
organization member. Do not add a skipped test or secret-dependent login flow.
The unit/component suites cover the hierarchy, and Step 6 records the manual
multi-persona matrix.

- [ ] **Step 3: Run targeted package tests**

```bash
pnpm --filter @workspace/auth test
pnpm --filter @apps/dashboard test
```

Expected: PASS.

- [ ] **Step 4: Run repository checks**

```bash
pnpm type-check
pnpm lint
pnpm format:check
```

Expected: PASS with no new diagnostics.

- [ ] **Step 5: Run the dashboard build**

```bash
pnpm --filter @apps/dashboard build
```

Expected: successful production build.

- [ ] **Step 6: Manual role-management matrix**

Using non-production seed data:

1. Owner sees edit controls for admin/member but not self/owner.
2. Admin sees edit controls only for ordinary members.
3. Member sees no mutation controls.
4. Individual replacement supports multiple roles.
5. Bulk add/remove reports updated, unchanged, and failed members correctly.
6. Multi-role invitation persists and displays all accepted roles.
7. Ownership transfer preserves target roles, removes owner from actor, and
   assigns actor admin when needed.
8. Refreshing the page shows persisted role badges and updated controls.

- [ ] **Step 7: Review the final diff for schema changes**

```bash
git diff -- packages/database/prisma
```

Expected: no output.

- [ ] **Step 8: Commit documentation or verification fixes**

```bash
git add .ai/conventions/org-roles.md
git commit -m "docs(auth): document organization role management"
```
