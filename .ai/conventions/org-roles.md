# Org Roles Convention

Organization RBAC is a static code-defined system in `packages/auth/src/org-roles/`. Do not add raw role-string comparisons anywhere in app or package code.

## Where roles live

| File | Purpose |
|------|---------|
| `org-roles/statement.ts` | `createAccessControl` statement + exported `ac` |
| `org-roles/roles.ts` | One `ac.newRole({...})` per role (`owner`, `admin`, `member`) |
| `org-roles/index.ts` | Exports `ac`, `statement`, `orgRoles` map, `OrgRoleId` type, `ASSIGNABLE_ORG_ROLE_IDS`, `memberRoleFieldHasPermission` helper |
| `permissions.ts` | Backward-compat re-export shim only — prefer importing from `./org-roles` or `@workspace/auth/org-roles` |

`orgRoles` must be registered on **both** server and client — keep them in sync:
- Server: `auth.ts` → `organization({ ac, roles: orgRoles })`
- Client: `auth-client.ts` → `organizationClient({ ac, roles: orgRoles })`

## Add-a-role checklist

1. Add `ac.newRole({...})` in `roles.ts`.
2. Register the key on `orgRoles` in `index.ts` (`OrgRoleId` widens automatically).
3. If assignable via UI, add it to `ASSIGNABLE_ORG_ROLE_IDS` and the invite/role-dialog options (invitations currently allow `admin`/`member` only).
4. Add unit tests for the new role's permission boundaries (`org-roles.test.ts` / `permissions.test.ts`).
5. Enforce with `hasPermission` in server code:
   - `requireOrgPermission*` guards in `guards.ts`
   - `getOrgPermissionContext` in server helpers
   - Dashboard action wrappers: `getApiKeyManageContextAction`, `getMemberManageContextAction` in `apps/dashboard/features/organization/data/org-permission-actions.ts`
   - **Never gate on raw role-string equality.**
6. No DB migration needed — roles are pure code; `Member.role` column is unchanged.

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
