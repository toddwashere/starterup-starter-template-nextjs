export { ac, statement } from "./statement";
export { owner, admin, member } from "./roles";

// Re-imported (not just re-exported above) because re-exported names can't be
// referenced locally in the same module — needed to build the orgRoles map.
import { owner, admin, member } from "./roles";

export const orgRoles = { owner, admin, member } as const;

export type OrgRoleId = keyof typeof orgRoles;

export const ASSIGNABLE_ORG_ROLE_IDS = ["owner", "admin", "member"] as const satisfies readonly OrgRoleId[];

export { memberRoleFieldHasPermission } from "./member-permissions";

export {
  ORG_ROLE_CATALOG,
  InvalidOrgRoleSetError,
  isOrgRoleId,
  normalizeOrgRoleIds,
  getHighestManagementRank,
  hasOwnershipRole,
  MEMBER_ASSIGNABLE_ORG_ROLE_IDS,
  INVITATION_ASSIGNABLE_ORG_ROLE_IDS,
  BULK_ASSIGNABLE_ORG_ROLE_IDS,
} from "./role-catalog";
export type { OrgRoleMetadata } from "./role-catalog";

export {
  evaluateMemberManagement,
  evaluateRoleAssignment,
  evaluateRoleAssignmentDelta,
  evaluateSelfRoleRetention,
  evaluateOwnershipTransfer,
} from "./member-role-policy";
export type {
  MemberManagementReason,
  MemberManagementDecision,
} from "./member-role-policy";
