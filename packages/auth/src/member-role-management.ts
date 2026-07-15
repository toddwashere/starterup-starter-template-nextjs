import { prisma, Prisma } from "@workspace/database";
import { parseOrgRoles } from "@workspace/common";
import { captureException } from "@workspace/observability/capture";
import { auth } from "./auth";
import {
  ORG_ROLE_CATALOG,
  InvalidOrgRoleSetError,
  normalizeOrgRoleIds,
  hasOwnershipRole,
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
 * Resolves the authenticated session or throws `UNAUTHENTICATED`. Shared by
 * every entry point that needs to identify the acting user before touching
 * org-scoped data.
 */
async function requireSession(headers: Headers) {
  const session = await auth.api.getSession({ headers });
  if (!session) {
    throw new MemberRoleManagementError(
      "UNAUTHENTICATED",
      "You must be signed in to manage member roles.",
    );
  }
  return session;
}

/**
 * Loads the acting member's identity, roles, and the org-wide permission
 * required for the calling operation — all scoped to the explicit
 * `organizationId`. Callers that manage existing members' roles check
 * `member:update` (the default); callers that create invitations must pass
 * `{ invitation: ["create"] }` instead, since inviting is a distinct
 * permission from updating an existing member's roles. Only throws for
 * conditions that make it impossible to identify an actor at all
 * (unauthenticated, not a member); a missing permission is surfaced via
 * `canManageMembers` and handled uniformly by the hierarchy evaluators.
 */
async function loadActorContext(
  headers: Headers,
  organizationId: string,
  permissions: Record<string, string[]> = { member: ["update"] },
): Promise<ActorContext> {
  const session = await requireSession(headers);

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
    body: { organizationId, permissions },
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

  const nonBulkAssignable = requestedRoles.find(
    (role) => !ORG_ROLE_CATALOG[role].bulkAssignable,
  );
  if (nonBulkAssignable) {
    throw new MemberRoleManagementError(
      "OWNER_PROTECTED",
      "The owner role cannot be assigned through ordinary role management.",
    );
  }

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

/**
 * Creates a Better Auth organization invitation carrying one or more org
 * roles. Every requested role must be `invitationAssignable` — ownership can
 * never be granted through an invitation — and the full requested role set
 * must be within the actor's assignment ceiling (an admin cannot invite
 * another admin). The actor must additionally hold `invitation:create` for
 * the explicit organization; `member:update` alone does not authorize
 * sending invitations. Throws `MemberRoleManagementError` for every expected
 * failure rather than returning an outcome, since there is no existing
 * target member to attach a per-member result to.
 */
export async function inviteMemberWithRoles(input: {
  headers: Headers;
  organizationId: string;
  email: string;
  roles: readonly string[];
}) {
  const actor = await loadActorContext(input.headers, input.organizationId, {
    invitation: ["create"],
  });
  if (!actor.canManageMembers) {
    throw new MemberRoleManagementError(
      "MISSING_PERMISSION",
      "You do not have permission to invite members.",
    );
  }

  const roles = normalizeOrgRoleIds(input.roles);
  if (roles.some((role) => !ORG_ROLE_CATALOG[role].invitationAssignable)) {
    throw new MemberRoleManagementError(
      "OWNER_PROTECTED",
      "Ownership cannot be assigned by invitation.",
    );
  }

  const assignment = evaluateRoleAssignment(actor.actorRoles, roles);
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

/**
 * Atomically transfers organization ownership from the actor to another
 * member. Better Auth 1.6.14 has no ownership-transfer endpoint, so this
 * writes both `Member` rows directly through Prisma inside a single
 * Serializable transaction — the actor/target lookups, the org-wide
 * multiple-owner drift check, and both role writes all run against the same
 * transactional client, so a concurrent transfer attempt cannot interleave
 * and leave the organization with zero or multiple owners. The former owner
 * keeps any non-owner roles they already held, falling back to `["admin"]`
 * if ownership was their only role; the target keeps their existing roles
 * and gains `owner`.
 */
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

      // Single source of truth for transfer eligibility — the same pure
      // policy `getMemberManagementContext` uses for the UI hint. Covers
      // non-owner actor (MISSING_PERMISSION), self-transfer (SELF),
      // target-already-owner (OWNER_PROTECTED), and unknown roles
      // (UNKNOWN_ROLE); every reason is a valid MemberRoleFailureCode.
      const decision = evaluateOwnershipTransfer({
        actorUserId: actor.userId,
        actorRoles,
        targetUserId: target.userId,
        targetRoles,
      });
      if (!decision.allowed) {
        throw new MemberRoleManagementError(
          decision.reason,
          "You cannot transfer ownership to this member.",
        );
      }

      // Data-integrity guard NOT covered by the eligibility policy: refuse to
      // transfer while the org has ownership-role drift (a member other than
      // the acting owner also carries an ownership role). Placed after the
      // eligibility gate so a non-owner actor gets MISSING_PERMISSION first.
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
