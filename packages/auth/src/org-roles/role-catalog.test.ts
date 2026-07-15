import { describe, expect, it } from "vitest";
import { orgRoles } from "./index";
import {
  InvalidOrgRoleSetError,
  ORG_ROLE_CATALOG,
  getHighestManagementRank,
  normalizeOrgRoleIds,
} from "./role-catalog";

describe("ORG_ROLE_CATALOG", () => {
  it("has one entry for every static Better Auth role", () => {
    expect(Object.keys(ORG_ROLE_CATALOG).sort()).toEqual(
      Object.keys(orgRoles).sort(),
    );
  });

  it("keeps owner out of ordinary assignment surfaces", () => {
    expect(ORG_ROLE_CATALOG.owner).toMatchObject({
      memberAssignable: false,
      invitationAssignable: false,
      bulkAssignable: false,
      ownership: true,
    });
  });

  it("normalizes, deduplicates, and registry-sorts roles", () => {
    expect(normalizeOrgRoleIds(["member", "admin", "member"])).toEqual([
      "admin",
      "member",
    ]);
  });

  it.each([[[]], [["unknown"]]] as [string[]][])(
    "rejects invalid role sets: %j",
    (roles) => {
      expect(() => normalizeOrgRoleIds(roles)).toThrow();
    },
  );

  it.each([[[""]], [["  "]]] as [string[]][])(
    "rejects blank/whitespace-only role sets: %j",
    (roles) => {
      expect(() => normalizeOrgRoleIds(roles)).toThrow();
      try {
        normalizeOrgRoleIds(roles);
        throw new Error("expected normalizeOrgRoleIds to throw");
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidOrgRoleSetError);
        expect((error as InvalidOrgRoleSetError).code).toBe("EMPTY_ROLE_SET");
      }
    },
  );

  it("uses the highest rank across combined roles", () => {
    expect(getHighestManagementRank(["member", "admin"])).toBe(20);
  });
});
