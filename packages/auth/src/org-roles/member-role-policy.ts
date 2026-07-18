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
  try {
    normalizeOrgRoleIds(input.actorRoles);
    normalizeOrgRoleIds(input.targetRoles);
  } catch {
    return { allowed: false, reason: "UNKNOWN_ROLE" };
  }

  // Self-edits are allowed for eligibility (opening the editor / bulk target).
  // Escalation and self-demotion are enforced at assignment time.
  if (input.actorUserId === input.targetUserId) {
    return { allowed: true, reason: null };
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

/**
 * Bounds a role-set change by evaluating only newly introduced roles.
 * Retaining an existing higher role (or ownership) while adding lower roles
 * is allowed; introducing ownership or same/higher-rank roles is not.
 */
export function evaluateRoleAssignmentDelta(
  actorRoles: readonly string[],
  currentRoles: readonly string[],
  nextRoles: readonly string[],
): MemberManagementDecision {
  try {
    const current = normalizeOrgRoleIds(currentRoles);
    const next = normalizeOrgRoleIds(nextRoles);
    const currentSet = new Set<string>(current);

    if (hasOwnershipRole(next) && !hasOwnershipRole(current)) {
      return { allowed: false, reason: "OWNER_PROTECTED" };
    }

    const introduced = next.filter((role) => !currentSet.has(role));
    if (introduced.length === 0) {
      return { allowed: true, reason: null };
    }
    return evaluateRoleAssignment(actorRoles, introduced);
  } catch {
    return { allowed: false, reason: "UNKNOWN_ROLE" };
  }
}

/**
 * Prevents an actor from stripping their own highest management role
 * (privilege retention). Additive self-changes that keep that role are allowed.
 */
export function evaluateSelfRoleRetention(
  currentRoles: readonly string[],
  nextRoles: readonly string[],
): MemberManagementDecision {
  try {
    const current = normalizeOrgRoleIds(currentRoles);
    const next = normalizeOrgRoleIds(nextRoles);
    const currentRank = getHighestManagementRank(current);
    const nextRank = getHighestManagementRank(next);
    if (nextRank < currentRank) {
      return { allowed: false, reason: "SELF" };
    }
    const retainedHighest = current.some(
      (role) =>
        getHighestManagementRank([role]) === currentRank && next.includes(role),
    );
    if (!retainedHighest) {
      return { allowed: false, reason: "SELF" };
    }
    return { allowed: true, reason: null };
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
