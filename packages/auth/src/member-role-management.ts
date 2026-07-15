import { prisma } from "@workspace/database";
import { parseOrgRoles } from "@workspace/common";
import { captureException } from "@workspace/observability/capture";
import { auth } from "./auth";
import {
  ORG_ROLE_CATALOG,
  InvalidOrgRoleSetError,
  normalizeOrgRoleIds,
  evaluateMemberManagement,
  evaluateRoleAssignment,
  evaluateOwnershipTransfer,
} from "./org-roles";
import type { OrgRoleId, MemberManagementReason } from "./org-roles";

/**
 * Server-only member role management service.
 *
 * Every entry point re-resolves the actor and target `Member` rows scoped to
 * the *explicit* `organizationId` supplied by the caller. Authority is never
 * inferred from the session's active organization, and targets are reloaded
 * immediately before each write so stale client-side eligibility cannot
 * bypass hierarchy enforcement.
 */

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

type ActorContext = {
  actorUserId: string;
  actorRoles: string[];
  canManageMembers: boolean;
};

const REASON_MESSAGES: Record<MemberManagementReason, string> = {
  MISSING_PERMISSION: "You do not have permission to manage member roles.",
  SELF: "You cannot change your own roles.",
  OWNER_PROTECTED: "The owner role is protected and cannot be changed here.",
  SAME_OR_HIGHER_RANK:
    "You cannot manage a member at the same or a higher rank than you.",
  UNKNOWN_ROLE: "Role configuration is out of date.",
};

function reasonMessage(reason: MemberManagementReason): string {
  return REASON_MESSAGES[reason];
}

function arraysEqual(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Loads the acting member's identity, roles, and org-wide `member:update`
 * permission — all scoped to the explicit `organizationId`. Only throws for
 * conditions that make it impossible to identify an actor at all
 * (unauthenticated, not a member); a missing permission is surfaced via
 * `canManageMembers` and handled uniformly by the hierarchy evaluators.
 */
async function loadActorContext(
  headers: Headers,
  organizationId: string,
): Promise<ActorContext> {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    throw new MemberRoleManagementError(
      "UNAUTHENTICATED",
      "You must be signed in to manage member roles.",
    );
  }

  const actorMember = await prisma.member.findFirst({
    where: { organizationId, userId: session.user.id },
  });
  if (!actorMember) {
    throw new MemberRoleManagementError(
      "NOT_A_MEMBER",
      "You are not a member of this organization.",
    );
  }

  const permission = await auth.api.hasPermission({
    headers,
    body: { organizationId, permissions: { member: ["update"] } },
  });

  return {
    actorUserId: session.user.id,
    actorRoles: parseOrgRoles(actorMember.role),
    canManageMembers: permission?.success === true,
  };
}

function toKnownError(
  error: unknown,
): { code: MemberRoleFailureCode; message: string } | null {
  if (error instanceof MemberRoleManagementError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof InvalidOrgRoleSetError) {
    return { code: error.code, message: error.message };
  }
  return null;
}

function toFailedOutcome(
  error: unknown,
  context: { operation: string; organizationId: string; memberId: string },
): MemberRoleOutcome {
  const known = toKnownError(error);
  if (known) {
    return { memberId: context.memberId, status: "failed", ...known };
  }
  // Log only operation name, organizationId, and memberId — never email
  // addresses or role payloads.
  captureException(error, context);
  return {
    memberId: context.memberId,
    status: "failed",
    code: "UPDATE_FAILED",
    message: "Failed to update member roles.",
  };
}

/**
 * Loads whether the actor can manage members and, for each requested member
 * ID, whether the actor may manage that target's roles (with a safe reason
 * when not) and whether the actor may transfer ownership to that target.
 * Non-throwing — mirrors `getOrgPermissionContext`'s UI-gating pattern.
 * Member IDs that no longer resolve inside the explicit organization are
 * omitted from the result.
 */
export async function getMemberManagementContext(
  headers: Headers,
  organizationId: string,
  memberIds: readonly string[],
): Promise<MemberManagementContext> {
  const actor = await loadActorContext(headers, organizationId);
  const members: MemberManagementContext["members"] = {};

  for (const memberId of memberIds) {
    const target = await prisma.member.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!target) continue;

    const targetRoles = parseOrgRoles(target.role);

    const managementDecision = evaluateMemberManagement({
      actorUserId: actor.actorUserId,
      actorRoles: actor.actorRoles,
      targetUserId: target.userId,
      targetRoles,
      hasMemberUpdatePermission: actor.canManageMembers,
    });

    const ownershipDecision = evaluateOwnershipTransfer({
      actorUserId: actor.actorUserId,
      actorRoles: actor.actorRoles,
      targetUserId: target.userId,
      targetRoles,
    });

    members[memberId] = {
      allowed: managementDecision.allowed,
      reason: managementDecision.allowed ? null : managementDecision.reason,
      canTransferOwnership: ownershipDecision.allowed,
    };
  }

  return {
    canManageMembers: actor.canManageMembers,
    actorRoles: actor.actorRoles,
    members,
  };
}

/**
 * Replaces one target member's complete non-owner role set. Validates the
 * requested roles, reloads the target scoped to the explicit organization,
 * enforces management hierarchy and role-assignment ceilings, then writes
 * through Better Auth. Never throws for expected failures — returns a
 * `MemberRoleOutcome` describing what happened.
 */
export async function replaceMemberRoles(input: {
  headers: Headers;
  organizationId: string;
  memberId: string;
  roles: string[];
}): Promise<MemberRoleOutcome> {
  const { headers, organizationId, memberId, roles } = input;

  try {
    const requestedRoles = normalizeOrgRoleIds(roles);

    const nonAssignable = requestedRoles.find(
      (role) => !ORG_ROLE_CATALOG[role].memberAssignable,
    );
    if (nonAssignable) {
      throw new MemberRoleManagementError(
        "OWNER_PROTECTED",
        "The owner role cannot be assigned through ordinary role management.",
      );
    }

    const actor = await loadActorContext(headers, organizationId);

    const target = await prisma.member.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!target) {
      throw new MemberRoleManagementError(
        "MEMBER_NOT_FOUND",
        "Member not found in this organization.",
      );
    }

    const currentRoles = normalizeOrgRoleIds(parseOrgRoles(target.role));

    const managementDecision = evaluateMemberManagement({
      actorUserId: actor.actorUserId,
      actorRoles: actor.actorRoles,
      targetUserId: target.userId,
      targetRoles: currentRoles,
      hasMemberUpdatePermission: actor.canManageMembers,
    });
    if (!managementDecision.allowed) {
      throw new MemberRoleManagementError(
        managementDecision.reason,
        reasonMessage(managementDecision.reason),
      );
    }

    // Independently bound the *assigned* roles against the actor's rank so
    // an admin cannot promote a member to admin even though the admin is
    // otherwise allowed to manage that member.
    const assignmentDecision = evaluateRoleAssignment(
      actor.actorRoles,
      requestedRoles,
    );
    if (!assignmentDecision.allowed) {
      throw new MemberRoleManagementError(
        assignmentDecision.reason,
        reasonMessage(assignmentDecision.reason),
      );
    }

    if (arraysEqual(currentRoles, requestedRoles)) {
      return { memberId, status: "unchanged", roles: currentRoles };
    }

    await auth.api.updateMemberRole({
      headers,
      body: { memberId, organizationId, role: requestedRoles },
    });

    return { memberId, status: "updated", roles: requestedRoles };
  } catch (error) {
    return toFailedOutcome(error, {
      operation: "member-role-replace",
      organizationId,
      memberId,
    });
  }
}

async function mutateSingleMemberRoles(input: {
  headers: Headers;
  organizationId: string;
  memberId: string;
  operation: "add" | "remove";
  requestedRoles: readonly OrgRoleId[];
  actor: ActorContext;
}): Promise<MemberRoleOutcome> {
  const { headers, organizationId, memberId, operation, requestedRoles, actor } =
    input;

  try {
    const target = await prisma.member.findFirst({
      where: { id: memberId, organizationId },
    });
    if (!target) {
      throw new MemberRoleManagementError(
        "MEMBER_NOT_FOUND",
        "Member not found in this organization.",
      );
    }

    const currentRoles = normalizeOrgRoleIds(parseOrgRoles(target.role));
    const nextRoles =
      operation === "add"
        ? normalizeOrgRoleIds([...currentRoles, ...requestedRoles])
        : normalizeOrgRoleIds(
            currentRoles.filter((role) => !requestedRoles.includes(role)),
          );

    const managementDecision = evaluateMemberManagement({
      actorUserId: actor.actorUserId,
      actorRoles: actor.actorRoles,
      targetUserId: target.userId,
      targetRoles: currentRoles,
      hasMemberUpdatePermission: actor.canManageMembers,
    });
    if (!managementDecision.allowed) {
      throw new MemberRoleManagementError(
        managementDecision.reason,
        reasonMessage(managementDecision.reason),
      );
    }

    // Evaluate the *resulting* complete role set — required for bulk add: an
    // admin may add ordinary member/functional roles but may not promote a
    // selected member to admin.
    const assignmentDecision = evaluateRoleAssignment(
      actor.actorRoles,
      nextRoles,
    );
    if (!assignmentDecision.allowed) {
      throw new MemberRoleManagementError(
        assignmentDecision.reason,
        reasonMessage(assignmentDecision.reason),
      );
    }

    if (arraysEqual(currentRoles, nextRoles)) {
      return { memberId, status: "unchanged", roles: currentRoles };
    }

    await auth.api.updateMemberRole({
      headers,
      body: { memberId, organizationId, role: nextRoles },
    });

    return { memberId, status: "updated", roles: nextRoles };
  } catch (error) {
    return toFailedOutcome(error, {
      operation: "member-role-bulk",
      organizationId,
      memberId,
    });
  }
}

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

/**
 * Bounded, best-effort bulk add/remove across multiple targets. The
 * requested role set is validated once up front — an invalid request never
 * starts any workers. Each target is then processed independently with
 * concurrency capped at 4; an expected failure on one target never rejects
 * the batch or blocks the remaining targets.
 */
export async function mutateMemberRoles(input: {
  headers: Headers;
  organizationId: string;
  memberIds: readonly string[];
  operation: "add" | "remove";
  roles: string[];
}): Promise<{ outcomes: MemberRoleOutcome[] }> {
  const { headers, organizationId, memberIds, operation, roles } = input;

  const requestedRoles = normalizeOrgRoleIds(roles);
  const actor = await loadActorContext(headers, organizationId);

  const outcomes = await mapWithConcurrency(memberIds, 4, (memberId) =>
    mutateSingleMemberRoles({
      headers,
      organizationId,
      memberId,
      operation,
      requestedRoles,
      actor,
    }),
  );

  return { outcomes };
}
