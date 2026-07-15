"use server";

import { auth } from "@workspace/auth";
import { requireOrgPermission, requireUser } from "@workspace/auth/guards";
import { headers } from "next/headers";
import {
  replaceMemberRoles,
  mutateMemberRoles,
  inviteMemberWithRoles,
  transferOrganizationOwnership,
  MemberRoleManagementError,
  type MemberRoleFailureCode,
  type MemberRoleOutcome,
} from "@workspace/auth/member-role-management";
import { InvalidOrgRoleSetError } from "@workspace/auth/org-roles";
import { captureException } from "@workspace/observability/capture";
import {
  replaceMemberRolesSchema,
  bulkMemberRolesSchema,
  inviteMemberSchema,
  transferOwnershipSchema,
} from "./org-types";

export async function createOrganizationAction(data: {
  name: string;
  slug: string;
}) {
  await requireUser();
  const requestHeaders = await headers();
  const result = await auth.api.createOrganization({
    body: { name: data.name, slug: data.slug },
    headers: requestHeaders,
  });
  return result;
}

/**
 * Discriminated result type shared by every guarded member-role action.
 * `INVALID_INPUT` covers schema-parse failures at the action boundary;
 * every other code is a `MemberRoleFailureCode` surfaced by the underlying
 * `@workspace/auth/member-role-management` service (see
 * `toMemberRoleActionError` below).
 */
export type MemberRoleActionResult<T> =
  | { success: true; data: T }
  | {
      success: false;
      error: { code: MemberRoleFailureCode | "INVALID_INPUT"; message: string };
    };

/**
 * Maps the two error classes the member-role-management service can throw
 * for *expected* pre-flight failures into a typed action result:
 *  - `MemberRoleManagementError` (`.code: MemberRoleFailureCode`) from
 *    `@workspace/auth/member-role-management` — unauthenticated, actor not a
 *    member, permission/hierarchy denials, etc.
 *  - `InvalidOrgRoleSetError` (`.code: "EMPTY_ROLE_SET" | "UNKNOWN_ROLE"`)
 *    from `@workspace/auth/org-roles` — both codes are valid
 *    `MemberRoleFailureCode` members, so no widening is needed.
 * Both branches are EXPECTED authorization/validation outcomes, not
 * incidents, so neither is captured for observability.
 *
 * Any OTHER (unexpected) error is never leaked to the client: it maps to a
 * generic `UPDATE_FAILED` message AND is captured for observability, tagged
 * with the `operation` label. `replaceMemberRoles`/`mutateMemberRoles`
 * already capture their own unexpected errors internally (they never throw),
 * but `inviteMemberWithRoles`/`transferOrganizationOwnership` throw straight
 * through to here, so this fallthrough is the only place their unexpected
 * failures get recorded. Only the operation label is included — never any
 * email address or role payload.
 */
function toMemberRoleActionError(
  error: unknown,
  operation: string,
): { success: false; error: { code: MemberRoleFailureCode; message: string } } {
  if (error instanceof MemberRoleManagementError) {
    return { success: false, error: { code: error.code, message: error.message } };
  }
  if (error instanceof InvalidOrgRoleSetError) {
    return { success: false, error: { code: error.code, message: error.message } };
  }
  captureException(error, { operation });
  return {
    success: false,
    error: {
      code: "UPDATE_FAILED",
      message: "Something went wrong updating roles. Please try again.",
    },
  };
}

/**
 * Replaces one member's complete role set. Note the asymmetry with the
 * other actions below: the service never throws for expected denials here —
 * it returns a `MemberRoleOutcome` with `status: "failed"` as in-band data,
 * so this action resolves `success: true` even when the underlying outcome
 * describes a denial. Only unexpected/thrown errors map to `success: false`.
 */
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
    return toMemberRoleActionError(error, "member-role-replace");
  }
}

/** Bounded best-effort bulk add/remove across multiple target members. */
export async function bulkMemberRolesAction(
  input: unknown,
): Promise<MemberRoleActionResult<{ outcomes: MemberRoleOutcome[] }>> {
  const parsed = bulkMemberRolesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "Check the selected members and roles.",
      },
    };
  }
  try {
    return {
      success: true,
      data: await mutateMemberRoles({
        ...parsed.data,
        headers: await headers(),
      }),
    };
  } catch (error) {
    return toMemberRoleActionError(error, "member-role-bulk");
  }
}

/**
 * Creates an invitation carrying one or more org roles. Replaces the old
 * single-role invite action: `roles` is forwarded as an array all the way
 * through to the service. Unlike `replaceMemberRolesAction`, the service
 * throws `MemberRoleManagementError` (or `InvalidOrgRoleSetError`) for
 * expected denials, so those surface here as typed `success: false` errors.
 */
export async function inviteMemberAction(
  input: unknown,
): Promise<
  MemberRoleActionResult<Awaited<ReturnType<typeof inviteMemberWithRoles>>>
> {
  const parsed = inviteMemberSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "Check the email address and selected roles.",
      },
    };
  }
  try {
    return {
      success: true,
      data: await inviteMemberWithRoles({
        ...parsed.data,
        headers: await headers(),
      }),
    };
  } catch (error) {
    return toMemberRoleActionError(error, "member-role-invite");
  }
}

/**
 * Transfers organization ownership atomically. Like invite, the service
 * throws on expected denials rather than returning in-band failure data.
 */
export async function transferOwnershipAction(
  input: unknown,
): Promise<
  MemberRoleActionResult<Awaited<ReturnType<typeof transferOrganizationOwnership>>>
> {
  const parsed = transferOwnershipSchema.safeParse(input);
  if (!parsed.success) {
    return {
      success: false,
      error: {
        code: "INVALID_INPUT",
        message: "Select a member to transfer ownership to.",
      },
    };
  }
  try {
    return {
      success: true,
      data: await transferOrganizationOwnership({
        ...parsed.data,
        headers: await headers(),
      }),
    };
  } catch (error) {
    return toMemberRoleActionError(error, "member-role-transfer");
  }
}

export async function removeMemberAction(data: {
  memberId: string;
  organizationId: string;
}) {
  await requireOrgPermission({ member: ["delete"] });
  const requestHeaders = await headers();
  const result = await auth.api.removeMember({
    body: {
      memberIdOrEmail: data.memberId,
      organizationId: data.organizationId,
    },
    headers: requestHeaders,
  });
  return result;
}

export async function cancelInvitationAction(data: {
  invitationId: string;
}) {
  await requireOrgPermission({ invitation: ["cancel"] });
  const requestHeaders = await headers();
  const result = await auth.api.cancelInvitation({
    body: { invitationId: data.invitationId },
    headers: requestHeaders,
  });
  return result;
}
