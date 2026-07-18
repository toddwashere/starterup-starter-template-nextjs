# Org Roles Convention

Organization RBAC is a static code-defined system in `packages/auth/src/org-roles/`. Do not add raw role-string comparisons anywhere in app or package code.

## Where roles live

| File                              | Purpose                                                                                                                                                                                                                            |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `org-roles/statement.ts`          | `createAccessControl` statement + exported `ac`                                                                                                                                                                                    |
| `org-roles/roles.ts`              | One `ac.newRole({...})` per role (`owner`, `admin`, `member`)                                                                                                                                                                      |
| `org-roles/index.ts`              | Exports `ac`, `statement`, `orgRoles` map, `OrgRoleId` type, `ASSIGNABLE_ORG_ROLE_IDS`, `memberRoleFieldHasPermission` helper, and re-exports the catalog (`role-catalog.ts`) and hierarchy policy (`member-role-policy.ts`) below |
| `org-roles/role-catalog.ts`       | `ORG_ROLE_CATALOG` metadata, `normalizeOrgRoleIds`, rank helpers, and the three UI assignability lists                                                                                                                             |
| `org-roles/member-role-policy.ts` | Pure hierarchy policy (`evaluateMemberManagement`, `evaluateRoleAssignment`, `evaluateOwnershipTransfer`) — no I/O                                                                                                                 |
| `member-role-management.ts`       | Server-only service that wraps the catalog + policy with Prisma/Better Auth I/O (see below)                                                                                                                                        |
| `permissions.ts`                  | Backward-compat re-export shim only — prefer importing from `./org-roles` or `@workspace/auth/org-roles`                                                                                                                           |

`orgRoles` must be registered on **both** server and client — keep them in sync:

- Server: `auth.ts` → `organization({ ac, roles: orgRoles })`
- Client: `auth-client.ts` → `organizationClient({ ac, roles: orgRoles })`

## Add-a-role checklist

1. Add `ac.newRole({...})` in `roles.ts`.
2. Register the key on `orgRoles` in `index.ts` (`OrgRoleId` widens automatically).
3. Add the role to `ORG_ROLE_CATALOG` in `role-catalog.ts` with `label`, `description`, `order`, `managementRank`, `ownership`, and the three assignability flags (`memberAssignable`, `invitationAssignable`, `bulkAssignable`) — see "Role catalog and hierarchy" below. Set `managementRank` relative to the existing roles; the UI option lists and invite/role-dialog options are derived from the catalog automatically, no separate list to update.
4. Add unit tests for the new role's permission boundaries (`org-roles.test.ts` / `permissions.test.ts`) and for its catalog/hierarchy behavior (`role-catalog.test.ts` / `member-role-policy.test.ts`).
5. Enforce with `hasPermission` in server code:
   - `requireOrgPermission*` guards in `guards.ts`
   - `getOrgPermissionContext` in server helpers
   - Dashboard action wrappers: `getApiKeyManageContextAction`, `getMemberManageContextAction` in `apps/dashboard/features/organization/data/org-permission-actions.ts`
   - **Never gate on raw role-string equality.**
6. No DB migration needed — roles are pure code; `Member.role` column is unchanged.

## Role catalog and hierarchy

`ORG_ROLE_CATALOG` (`packages/auth/src/org-roles/role-catalog.ts`) is the **single source of truth** for UI role options and assignability. Each entry carries:

- `label` / `description` / `order` — display metadata, including the option ordering in role pickers.
- `managementRank` — a numeric rank used to compare an actor's highest role against a target's highest role (higher outranks lower).
- `ownership` — `true` only for `owner`.
- `memberAssignable` / `invitationAssignable` / `bulkAssignable` — independent flags controlling whether a role can be granted via ordinary member-role replacement, invitation, or bulk add/remove, respectively.

The dashboard UI never hardcodes a role list: `edit-member-roles-button-modal.tsx` reads `MEMBER_ASSIGNABLE_ORG_ROLE_IDS`, `invite-member-button-modal.tsx` reads `INVITATION_ASSIGNABLE_ORG_ROLE_IDS`, and `bulk-edit-member-roles-button-modal.tsx` reads `BULK_ASSIGNABLE_ORG_ROLE_IDS` — all three are derived from the catalog's flags via `Object.keys(ORG_ROLE_CATALOG).filter(...)`. Adding a role to the catalog with the right flags is sufficient to surface it everywhere it should appear; no separate UI option list needs editing. (`ASSIGNABLE_ORG_ROLE_IDS` in `index.ts` is the older full-role-id list used by tests that assert `orgRoles` composition — it is not the UI option source.)

**Owner is never assignable.** `owner.memberAssignable`, `owner.invitationAssignable`, and `owner.bulkAssignable` are all `false` in the catalog. Ownership can only change hands through `transferOrganizationOwnership` (see below) — never through `replaceMemberRoles`, `mutateMemberRoles` (bulk add/remove), or `inviteMemberWithRoles`. Each of those entry points independently rejects any requested role set containing `owner` with `OWNER_PROTECTED`, even if the flag check were somehow bypassed.

`getHighestManagementRank(roles)` returns the highest `managementRank` across a member's (possibly multi-role) CSV role set. The pure policy in `member-role-policy.ts` uses it, plus `hasOwnershipRole`, to enforce actor/target hierarchy without any I/O:

- `evaluateMemberManagement({ actorUserId, actorRoles, targetUserId, targetRoles, hasMemberUpdatePermission })` — may the actor touch this target's roles at all? Denies on missing `member:update` permission, an owner target (`OWNER_PROTECTED`) when the target is someone else, or the actor's highest rank not exceeding the target's highest rank (`SAME_OR_HIGHER_RANK` — an admin cannot manage another admin). **Self-targets are allowed** when the actor has `member:update` so owners/admins can add lower roles to themselves; escalation and self-demotion are enforced at assignment time.
- `evaluateRoleAssignment(actorRoles, assignedRoles)` — independently bounds roles being granted, so an admin managing an eligible member still cannot promote that member to admin. Denies on an owner role in the assigned set (`OWNER_PROTECTED`) or the actor's rank not exceeding the assigned set's highest rank (`SAME_OR_HIGHER_RANK`).
- `evaluateRoleAssignmentDelta(actorRoles, currentRoles, nextRoles)` — like assignment, but only newly introduced roles are rank-checked (so keeping `admin` while adding `member` is allowed). Introducing ownership is still denied; retaining an existing ownership role is allowed.
- `evaluateSelfRoleRetention(currentRoles, nextRoles)` — for self-edits only: denies stripping your own highest management role (`SELF`). Additive self-changes that keep that role are allowed.
- `evaluateOwnershipTransfer({ actorUserId, actorRoles, targetUserId, targetRoles })` — may the actor transfer ownership to this target? Requires the actor to currently hold `owner`, denies self-transfer, and denies a target that already holds `owner`.

All three **fail closed on unknown persisted roles**: `normalizeOrgRoleIds` throws `InvalidOrgRoleSetError("UNKNOWN_ROLE", ...)` for any role string not present in the catalog (e.g. stale data from a removed role), and each evaluator catches that and returns `{ allowed: false, reason: "UNKNOWN_ROLE" }` rather than allowing the operation through.

## Server-only member role management service

`@workspace/auth/member-role-management` (`packages/auth/src/member-role-management.ts`) wraps the catalog and policy with the actual Prisma/Better Auth I/O:

- `getMemberManagementContext` — non-throwing, UI-gating context (mirrors `getOrgPermissionContext`'s pattern): for each requested member id, whether the actor can manage it (and why not) and whether the actor can transfer ownership to it.
- `replaceMemberRoles` — replaces one target's assignable role set (preserves any ownership role already on the target). Validates the requested roles against `memberAssignable`, reloads the target, enforces `evaluateMemberManagement`, `evaluateRoleAssignmentDelta`, and `evaluateSelfRoleRetention` for self-edits, and only calls `auth.api.updateMemberRole` if the resulting set actually differs.
- `mutateMemberRoles` — **bulk add/remove**, best-effort across multiple target member ids with concurrency bounded to 4 (`mapWithConcurrency`). The requested role set is validated once up front against `bulkAssignable` (an invalid request — including a non-`bulkAssignable` role — never starts any workers); each target is then evaluated and written independently (with a per-target `evaluateRoleAssignment` rank check as defense in depth), so one target's expected failure (e.g. `SAME_OR_HIGHER_RANK`) never blocks or fails the rest of the batch. Add/remove is computed against each target's _current_ full role set and only touches the requested roles — unrelated existing roles on that member are preserved. Returns `{ outcomes: MemberRoleOutcome[] }` with one outcome per member: `updated`, `unchanged`, or `failed` (with a `MemberRoleFailureCode` and safe message).
- `inviteMemberWithRoles` — creates a Better Auth invitation carrying one or more roles. Requires `invitation:create` (distinct from `member:update`), validates every role is `invitationAssignable`, and bounds the full requested set against the actor's rank via `evaluateRoleAssignment`.
- `transferOrganizationOwnership` — see below.

Every entry point re-resolves the actor and target `Member` rows scoped to the **explicit `organizationId`** the caller supplies — authority is never inferred from the session's active organization — and reloads targets immediately before each write so stale client-side eligibility state can't bypass hierarchy enforcement server-side.

This module is exposed as its **own package subpath** (`"./member-role-management": "./src/member-role-management.ts"` in `packages/auth/package.json`), separate from `@workspace/auth/org-roles` and **not re-exported from the package's main `index.ts`**. It imports `@workspace/database` (Prisma) and calls `auth.api.*`, so it must never end up in a client bundle; keeping it off the main export surface means an accidental `import { X } from "@workspace/auth"` in a client component cannot pull it in. Only import it from server-only code (server actions, route handlers).

## Multi-role invitations and ownership transfer

Multi-role invitations remain **CSV in the existing `Invitation.role` string** — no schema change. `inviteMemberWithRoles` accepts a role **array**, normalizes and validates it, and passes the array straight to `auth.api.createInvitation`, which Better Auth serializes onto `Invitation.role` the same way it does for `Member.role`. On acceptance, the invited member ends up with all accepted roles, parsed the same way as any other multi-role member (`parseOrgRoles`).

Better Auth 1.6.14 has no ownership-transfer API. `transferOrganizationOwnership` (in `member-role-management.ts`) implements it as a **single Serializable Prisma transaction** (`prisma.$transaction(..., { isolationLevel: Prisma.TransactionIsolationLevel.Serializable })`) that:

1. Loads the actor and target `Member` rows inside the transaction.
2. Runs `evaluateOwnershipTransfer` (the same pure policy the UI hint in `getMemberManagementContext` uses) to check actor-is-owner, no self-transfer, target-not-already-owner.
3. Checks for ownership-role drift (any other member besides the actor already holding `owner`) and refuses the transfer if found — a data-integrity guard not covered by the eligibility policy itself.
4. Writes both `Member` rows in the same transaction: the target gains `owner` (keeping their existing roles), and the actor loses `owner` — keeping any other roles they already held, or falling back to `["admin"]` so an otherwise-roleless former owner is never left with zero roles.

Running the lookups, the drift check, and both writes on the same transactional client under `Serializable` isolation is what makes the transfer atomic — a concurrent transfer attempt cannot interleave and leave the organization with zero or multiple owners.

## Test coverage and why there is no role-management E2E

Role management is covered by:

- Pure policy unit tests: `org-roles/role-catalog.test.ts`, `org-roles/member-role-policy.test.ts`.
- Service-level unit tests against the Prisma/Better Auth wiring: `member-role-management.test.ts` (covers `replaceMemberRoles`, `mutateMemberRoles`, `inviteMemberWithRoles`, and `transferOrganizationOwnership`, including the hierarchy-denial and unknown-role paths).
- Dashboard action and component tests: `org-actions.test.ts`, `org-permission-actions.test.ts`, `org-types.test.ts`, and the modal/component tests under `apps/dashboard/features/organization/ui/*.test.tsx`.

Deliberately **not added**: an end-to-end test exercising the full owner/admin/member hierarchy through the browser. The repo's saved Playwright auth state authenticates a single persona — an ordinary organization member (`user@example.com`) — because that's what the existing E2E fixtures set up. A meaningful role-management E2E needs at least three distinct authenticated personas (owner, admin, member) acting on the same organization, which would require either checking in additional credentials/secrets or scripting a multi-account login/seeding flow into the E2E harness. Rather than add a skipped test or a secret-dependent login flow as a placeholder, this feature relies on the unit/component suites above to cover the actor/target hierarchy logic, and on the manual matrix below to verify the full multi-persona flow end-to-end by hand before/after any change that touches this area.

### Manual multi-persona QA matrix

Run this against non-production seed data (an organization with an owner, an admin, and at least one plain member) whenever role-management UI or the underlying service changes:

1. Owner sees edit controls for admin and member rows, but not on their own row or any other owner row.
2. Admin sees edit controls only for ordinary (non-admin, non-owner) member rows.
3. Member sees no role-mutation controls anywhere on the page.
4. Individual role replacement (`replaceMemberRoles`) supports selecting multiple roles for one member.
5. Bulk add/remove reports correctly which members were `updated`, `unchanged`, and `failed`.
6. A multi-role invitation persists all selected roles and, once accepted, the member displays all accepted roles.
7. Ownership transfer preserves the target's existing roles (plus new `owner`), removes `owner` from the acting owner (falling back to `admin` if they held no other role), and the page reflects both changes.
8. Refreshing the page after any of the above shows the persisted role badges and correctly re-gated controls (no stale client-side state).

## Multi-role storage and usage

Better Auth stores multiple roles as a CSV string on `Member.role` (e.g. `"admin,member"`).

- `authClient.organization.updateMemberRole({ role })` and `inviteMember` accept `string | string[]`.
- `auth.api.hasPermission` unions permissions across all of a member's roles.
- Parse the CSV with `parseOrgRoles(roleField): string[]` from `@workspace/common` (split/trim/drop-empties).
- For a union permission check off a raw CSV field (no request context), use `memberRoleFieldHasPermission(roleField, required)` from `@workspace/auth/org-roles`.

## Billing authorize note

`packages/billing/src/authorize-org-billing.ts` gates on a `BILLING_MANAGE_ROLES` set (`owner`, `admin`) checked against `parseOrgRoles(member.role)`. If you add a billing-capable role, add its id to `BILLING_MANAGE_ROLES`, or refactor `authorizeOrgBilling` to a `hasPermission({ billing: ["manage"] })` check (future).

## Healthcare / regulated-context guidance

For adopters in regulated contexts: apply separation of duties, least privilege, and audit all role changes. Never log PHI in role-change payloads. These are guidance only — the template ships only `owner`/`admin`/`member`.

## Audit logging (phase 2, not yet implemented)

Membership changes should be auditable. Options:

- Wrap dashboard org actions
- Better Auth `databaseHooks`
- Append-only `OrgAuditEvent` table

Recommended events: `member.roles_updated`, `member.invited`, `member.removed` — payloads with ids/roles only, no PHI.
