import { describe, expect, it } from "vitest";
import { getMemberManagementPresentation } from "./member-management-eligibility";

describe("getMemberManagementPresentation", () => {
  it.each([
    [null, true, null],
    ["SELF", false, "You cannot remove your highest role from yourself."],
    ["OWNER_PROTECTED", false, "Ownership changes use Transfer ownership."],
    ["SAME_OR_HIGHER_RANK", false, "Only owners can manage admins."],
    ["MISSING_PERMISSION", false, "You do not have permission to manage roles."],
    ["UNKNOWN_ROLE", false, "Role configuration must be repaired before editing."],
  ] as const)("%s", (reason, selectable, message) => {
    expect(getMemberManagementPresentation(reason)).toEqual({
      editable: selectable,
      selectable,
      protectedMessage: message,
    });
  });
});
