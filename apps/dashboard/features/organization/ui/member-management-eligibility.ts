import type { MemberManagementReason } from "@workspace/auth/org-roles";

/**
 * UI-facing presentation for a member's per-row management decision. Mirrors
 * `MemberManagementReason` (the server's policy reason) with copy suitable
 * for the members list: whether the row's roles are editable, whether the
 * row may be selected for bulk actions, and — when neither — the message to
 * show in place of the disabled controls.
 */
export type MemberManagementPresentation = {
  editable: boolean;
  selectable: boolean;
  protectedMessage: string | null;
};

const REASON_PRESENTATION: Record<
  MemberManagementReason,
  { message: string }
> = {
  SELF: { message: "You cannot remove your highest role from yourself." },
  OWNER_PROTECTED: { message: "Ownership changes use Transfer ownership." },
  SAME_OR_HIGHER_RANK: { message: "Only owners can manage admins." },
  MISSING_PERMISSION: {
    message: "You do not have permission to manage roles.",
  },
  UNKNOWN_ROLE: {
    message: "Role configuration must be repaired before editing.",
  },
};

function assertUnreachable(value: never): never {
  throw new Error(`Unhandled MemberManagementReason: ${String(value)}`);
}

/**
 * Exhaustive mapping from a member's management decision reason (or `null`
 * when the actor is allowed to manage the member) to the UI presentation for
 * that row. `null` means the row is fully editable and selectable; any
 * `MemberManagementReason` means the row is protected and both `editable`
 * and `selectable` are `false`.
 */
export function getMemberManagementPresentation(
  reason: MemberManagementReason | null,
): MemberManagementPresentation {
  if (reason === null) {
    return { editable: true, selectable: true, protectedMessage: null };
  }

  switch (reason) {
    case "SELF":
    case "OWNER_PROTECTED":
    case "SAME_OR_HIGHER_RANK":
    case "MISSING_PERMISSION":
    case "UNKNOWN_ROLE":
      return {
        editable: false,
        selectable: false,
        protectedMessage: REASON_PRESENTATION[reason].message,
      };
    default:
      return assertUnreachable(reason);
  }
}
