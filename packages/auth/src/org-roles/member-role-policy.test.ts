import { describe, expect, it } from "vitest";
import {
  evaluateMemberManagement,
  evaluateOwnershipTransfer,
  evaluateRoleAssignment,
} from "./member-role-policy";

describe("evaluateMemberManagement", () => {
  it.each([
    ["owner", "admin", true, null],
    ["owner", "member", true, null],
    ["admin", "member", true, null],
    ["admin", "admin", false, "SAME_OR_HIGHER_RANK"],
    ["admin", "owner", false, "OWNER_PROTECTED"],
    ["member", "member", false, "MISSING_PERMISSION"],
  ] as const)(
    "%s managing %s",
    (actorRole, targetRole, allowed, reason) => {
      expect(
        evaluateMemberManagement({
          actorUserId: "actor",
          actorRoles: [actorRole],
          targetUserId: "target",
          targetRoles: [targetRole],
          hasMemberUpdatePermission: actorRole !== "member",
        }),
      ).toEqual({ allowed, reason });
    },
  );

  it("rejects self-management", () => {
    expect(
      evaluateMemberManagement({
        actorUserId: "same",
        actorRoles: ["owner"],
        targetUserId: "same",
        targetRoles: ["member"],
        hasMemberUpdatePermission: true,
      }),
    ).toEqual({ allowed: false, reason: "SELF" });
  });
});

describe("evaluateRoleAssignment", () => {
  it("allows owner to assign admin and admin to assign member", () => {
    expect(evaluateRoleAssignment(["owner"], ["admin"])).toEqual({
      allowed: true,
      reason: null,
    });
    expect(evaluateRoleAssignment(["admin"], ["member"])).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it("prevents admin from assigning admin or owner", () => {
    expect(evaluateRoleAssignment(["admin"], ["admin"]).allowed).toBe(false);
    expect(evaluateRoleAssignment(["admin"], ["owner"]).allowed).toBe(false);
  });
});

describe("evaluateOwnershipTransfer", () => {
  it("allows only an owner to transfer to a different non-owner", () => {
    expect(
      evaluateOwnershipTransfer({
        actorUserId: "owner",
        actorRoles: ["owner"],
        targetUserId: "member",
        targetRoles: ["member"],
      }),
    ).toEqual({ allowed: true, reason: null });
    expect(
      evaluateOwnershipTransfer({
        actorUserId: "admin",
        actorRoles: ["admin"],
        targetUserId: "member",
        targetRoles: ["member"],
      }).allowed,
    ).toBe(false);
  });
});
