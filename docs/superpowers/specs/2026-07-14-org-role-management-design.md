# Organization Role Management

**Date:** 2026-07-14  
**Status:** Approved

## Overview

Organization owners and admins need a discoverable, secure way to manage member
roles individually and in bulk. The repository already supports Better Auth's
CSV-backed multi-role storage, permission unioning, role badges, and an
individual multi-select dialog. This design adds the missing server-enforced
management hierarchy, bulk add/remove operations, multi-role invitations, and
a dedicated ownership-transfer flow.

The role system remains static and code-defined. This release adds no new
functional roles and no database migration. Future roles added to the shared
registry will automatically become available in the appropriate management
surfaces.

This spec supersedes the role-management UI and owner-policy portions of
`2026-05-25-org-multi-role-static-roles-design.md`. Its underlying storage and
permission-registry decisions remain in force.

---

## Current State and Gaps

- `Member.role` stores one or more role IDs as CSV, and Better Auth unions their
  permissions.
- The shipped role registry contains `owner`, `admin`, and `member`.
- The Members page parses and displays multiple role badges.
- The existing "Change Role" dialog sends a role array directly from the client.
- A server permission query hides all member actions from users without
  `member:update`.
- The UI hides actions for the signed-in user and every owner, but it does not
  distinguish an owner managing an admin from an admin managing another admin.
- Policy is therefore incomplete: an admin can reach the same mutation API as
  an owner unless the server independently applies target hierarchy.
- The list has no selection or bulk actions, invitations accept one role, and
  ownership transfer has no dedicated UI.

## Decisions

- Keep Better Auth's CSV role storage and static access-control registry.
- Roles remain freely combinable; the service requires at least one role but
  does not require exactly one baseline role.
- Add no product-specific functional roles in this release.
- Enforce hierarchy in a server-only role-management service. UI eligibility is
  informative, not authoritative.
- Keep the small-organization model: one loaded member list, no pagination,
  search, or server-side "select all."
- Support individual replacement plus bulk add/remove. Bulk operations are
  best-effort and return per-member outcomes.
- Allow multiple roles on invitations.
- Exclude `owner` from ordinary role editing and transfer ownership atomically
  in the auth package.
- Defer persistent audit logging to a separate phase.

## Static Role Catalog

`packages/auth/src/org-roles/` remains the source of truth for permissions and
role IDs. Add serializable UI/policy metadata keyed by `OrgRoleId`, including:

- display label and description;
- deterministic display order;
- whether the role is offered for existing-member assignment;
- whether the role is offered on invitations;
- whether the role is allowed in bulk operations;
- management rank used by hierarchy helpers;
- whether the role represents organization ownership.

The Better Auth `orgRoles` map remains registered on both client and server.
Management surfaces derive their options from the catalog rather than
hard-coding role unions. `owner` is marked as ownership-only and is not offered
by ordinary role or invitation selectors.

Role arrays are normalized before persistence: trim, reject empty or unknown
IDs, deduplicate, and sort by registry order. Unknown legacy values remain
visible as read-only badges, but every role mutation for that target fails
closed until the configuration or persisted data is corrected. This prevents
the UI from silently removing or re-submitting an unrecognized privilege.

## Authorization and Hierarchy

Every mutation receives an explicit `organizationId` and re-resolves the actor
and targets on the server. It must not rely only on the session's active
organization.

The service first requires `member:update`, then applies target hierarchy:

- an owner may manage non-owner admins and members;
- an admin may manage members who hold neither `owner` nor `admin`;
- members cannot manage roles;
- nobody may edit their own roles through ordinary role actions;
- nobody may add or remove `owner` through ordinary role actions;
- an actor may not manage a target at the same or a higher management rank.

Rank and ownership checks use exported registry helpers, not raw role-string
comparisons in app code. If an actor or target has several roles, the highest
management rank controls eligibility.

The same rules apply to individual and bulk actions. Targets are reloaded
immediately before each mutation so stale client eligibility cannot bypass the
policy.

## Server APIs and Data Flow

Dashboard server actions are thin adapters over a server-only service in the
auth package:

1. **Get management context**
   - Returns whether the actor can manage roles and per-member eligibility or a
     safe protected-state reason for the loaded member IDs.
2. **Replace member roles**
   - Replaces one target's complete non-owner role set after validation and
     hierarchy checks.
3. **Bulk add roles**
   - Unions selected role IDs into each eligible target's current role set.
4. **Bulk remove roles**
   - Removes selected role IDs while preserving all others.
   - Rejects a target if the result would contain zero roles.
5. **Invite member**
   - Accepts a non-empty role array derived from invitation-assignable catalog
     entries.
6. **Transfer ownership**
   - Requires the current owner, rejects self-transfer, and updates both member
     role fields in one serializable database transaction.
   - Preserves all non-owner roles. If removing `owner` would leave the previous
     owner with no role, assigns `admin`.

Bulk inputs contain a bounded list of member IDs and a non-empty role list.
Processing uses limited concurrency. Each member returns one of:

- `updated`, with normalized resulting roles;
- `unchanged`, when the requested operation has no effect;
- `failed`, with a stable safe reason suitable for display.

A failed target does not stop other targets. The client clears selection only
for successful or unchanged targets, leaving failures selected for review or
retry.

Better Auth updates the complete role field, so concurrent edits to the same
member remain last-writer-wins. Reloading immediately before mutation narrows
the race but does not create compare-and-swap semantics. Atomic cross-member
transactions are out of scope.

## Members and Invitation UX

Refactor the Members view to the repository's shared responsive data-view
pattern without adding pagination:

- desktop table: selection checkbox, member, role badges, joined date, and
  three-dot actions;
- mobile cards: the same information, eligibility, selection, and actions;
- only manageable members can be selected;
- protected members remain visible with concise explanations such as
  "You cannot edit your own roles" or "Only owners can manage admins."

The individual three-dot menu contains:

- **Edit roles** for manageable members;
- **Transfer ownership** for owner actors and eligible targets;
- existing removal actions, still subject to their own authorization rules.

The Edit Roles modal uses the static catalog, excludes `owner`, and replaces the
target's complete non-owner role set. Existing organization dialogs touched by
this work migrate to the repository's NiceModal convention.

When selection is non-empty, the standard bulk-action bar offers:

- **Add roles**, preserving every existing role;
- **Remove roles**, preserving every unselected role.

The bulk modal previews the operation and selected count. Completion reports
updated, unchanged, and failed counts, with member names and safe failure
reasons where needed. The UI does not optimistically mutate role badges.

The invitation modal uses the same catalog-derived multi-select, excludes
`owner`, requires at least one role, and submits a role array.

Ownership transfer is a separate confirmation flow. It explains that the
current owner loses ownership, becomes an admin if they had no other role, and
the target gains ownership while retaining their existing roles. Role editing
never attempts to simulate ownership transfer with two ordinary Better Auth
updates.

All successful mutations invalidate the organization/member queries and show a
concise toast.

## Error Handling

- Validation and expected authorization failures use typed result codes rather
  than parsing exception messages.
- Bulk results identify only the targets and safe reasons needed by the UI.
- Unexpected failures are logged without role payloads containing personal or
  regulated data and are displayed as a generic error.
- A target becoming ineligible between rendering and submission is a normal
  per-member failure, not a page-level crash.
- Unknown registry roles or malformed persisted role fields fail closed.

## Out of Scope

- New product-specific functional roles.
- Organization-defined dynamic roles or permission editors.
- Pagination, filtering, or server-side selection of all matching members.
- Persistent audit-event storage or an audit-log UI.
- Atomic transactions across multiple member updates.
- A new membership database model.
- Unrelated organization-settings redesign.

## Critical Tests

- `packages/auth/src/org-roles/role-catalog.test.ts`: catalog keys match
  `orgRoles`; owner is excluded from ordinary/invitation/bulk assignment;
  normalization rejects unknown and empty role sets, deduplicates, and applies
  deterministic order; highest management rank is derived across multiple
  roles.
- `packages/auth/src/org-roles/member-role-management.test.ts`: owner can manage
  admin/member targets; admin can manage member but not admin/owner targets;
  self-edit and ordinary owner mutation are denied; target membership is scoped
  to the explicit organization; each target is reloaded before mutation.
- `packages/auth/src/org-roles/member-role-bulk.test.ts`: add/remove preserves
  unrelated roles; final-role removal fails; mixed updated/unchanged/failed
  outcomes continue after individual failures; processing concurrency is
  bounded.
- `apps/dashboard/features/organization/data/org-types.test.ts`: individual,
  bulk, invitation, and transfer schemas reject malformed IDs, empty target or
  role arrays, unknown roles, and owner in ordinary mutations.
- `apps/dashboard/features/organization/data/org-actions.test.ts`: actions pass
  the explicit organization ID to the auth service; invitation forwards a role
  array; transfer delegates to the atomic auth service; typed service failures
  are preserved.
- `apps/dashboard/features/organization/ui/member-management-eligibility.test.ts`:
  owner/admin/member viewers receive the correct editable, selectable, and
  protected states for self, owner, admin, and member targets.
- `apps/dashboard/features/organization/ui/members-list.test.tsx`: desktop and
  mobile views share selection; protected rows cannot be selected; individual
  actions and bulk bar appear only when eligible; successful bulk targets clear
  while failures remain selected.
- `apps/dashboard/features/organization/ui/edit-member-roles-button-modal.test.tsx`:
  options come from the catalog, owner is absent, existing roles initialize
  correctly, unknown roles block replacement, and success invalidates member
  data.
- `apps/dashboard/features/organization/ui/bulk-edit-member-roles-button-modal.test.tsx`:
  add/remove intent is explicit, completion summarizes partial results, and
  failed members remain available for retry.
- `apps/dashboard/features/organization/ui/invite-member-button-modal.test.tsx`:
  multiple invitation roles are selectable, owner is absent, and at least one
  role is required.
- `apps/dashboard/features/organization/ui/transfer-ownership-confirm-dialog.test.tsx`:
  only an eligible owner can submit, the consequence is explicit, and success
  refreshes member-management context.

## Verification

- `pnpm type-check`
- `pnpm lint`
- `pnpm test --filter @workspace/auth`
- Targeted dashboard organization feature tests.
- Dashboard E2E smoke, when multi-session fixtures are available: owner edits
  admin/member; admin edits member but not admin; member sees no management
  actions; bulk add/remove refreshes badges; ownership transfer updates controls.
