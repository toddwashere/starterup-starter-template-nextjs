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
