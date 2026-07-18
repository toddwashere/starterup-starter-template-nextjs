import { describe, expect, it } from "vitest";
import {
  evaluateMemberManagement,
  evaluateOwnershipTransfer,
  evaluateRoleAssignment,
  evaluateRoleAssignmentDelta,
  evaluateSelfRoleRetention,
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

  it("fails closed with UNKNOWN_ROLE for an unrecognized role", () => {
    expect(
      evaluateMemberManagement({
        actorUserId: "a",
        actorRoles: ["superadmin"],
        targetUserId: "b",
        targetRoles: ["member"],
        hasMemberUpdatePermission: true,
      }),
    ).toEqual({ allowed: false, reason: "UNKNOWN_ROLE" });
  });

  it("allows self-management when the actor has member:update", () => {
    expect(
      evaluateMemberManagement({
        actorUserId: "same",
        actorRoles: ["owner"],
        targetUserId: "same",
        targetRoles: ["owner"],
        hasMemberUpdatePermission: true,
      }),
    ).toEqual({ allowed: true, reason: null });
    expect(
      evaluateMemberManagement({
        actorUserId: "same",
        actorRoles: ["admin"],
        targetUserId: "same",
        targetRoles: ["admin"],
        hasMemberUpdatePermission: true,
      }),
    ).toEqual({ allowed: true, reason: null });
  });

  it("rejects self-management without member:update", () => {
    expect(
      evaluateMemberManagement({
        actorUserId: "same",
        actorRoles: ["member"],
        targetUserId: "same",
        targetRoles: ["member"],
        hasMemberUpdatePermission: false,
      }),
    ).toEqual({ allowed: false, reason: "MISSING_PERMISSION" });
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

describe("evaluateRoleAssignmentDelta", () => {
  it("allows keeping an existing high role while adding a lower one", () => {
    expect(
      evaluateRoleAssignmentDelta(
        ["admin"],
        ["admin"],
        ["admin", "member"],
      ),
    ).toEqual({ allowed: true, reason: null });
    expect(
      evaluateRoleAssignmentDelta(
        ["owner"],
        ["owner"],
        ["owner", "admin"],
      ),
    ).toEqual({ allowed: true, reason: null });
  });

  it("still blocks introducing a same-or-higher rank role", () => {
    expect(
      evaluateRoleAssignmentDelta(["admin"], ["member"], ["admin"]),
    ).toEqual({ allowed: false, reason: "SAME_OR_HIGHER_RANK" });
  });

  it("blocks introducing ownership", () => {
    expect(
      evaluateRoleAssignmentDelta(["admin"], ["admin"], ["owner", "admin"]),
    ).toEqual({ allowed: false, reason: "OWNER_PROTECTED" });
  });

  it("allows retaining an existing ownership role", () => {
    expect(
      evaluateRoleAssignmentDelta(
        ["owner"],
        ["owner"],
        ["owner", "member"],
      ),
    ).toEqual({ allowed: true, reason: null });
  });
});

describe("evaluateSelfRoleRetention", () => {
  it("allows additive self changes that keep the highest role", () => {
    expect(
      evaluateSelfRoleRetention(["owner"], ["owner", "admin"]),
    ).toEqual({ allowed: true, reason: null });
    expect(
      evaluateSelfRoleRetention(["admin"], ["admin", "member"]),
    ).toEqual({ allowed: true, reason: null });
  });

  it("rejects removing your own highest role", () => {
    expect(
      evaluateSelfRoleRetention(["admin", "member"], ["member"]),
    ).toEqual({ allowed: false, reason: "SELF" });
    expect(evaluateSelfRoleRetention(["owner", "admin"], ["admin"])).toEqual({
      allowed: false,
      reason: "SELF",
    });
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
