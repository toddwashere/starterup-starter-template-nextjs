import { describe, it, expect } from "vitest";
import { orgRoles, ASSIGNABLE_ORG_ROLE_IDS, ac } from "./index";

describe("org-roles registry", () => {
  it("orgRoles has exactly the keys owner, admin, member", () => {
    expect(Object.keys(orgRoles)).toEqual(["owner", "admin", "member"]);
  });

  it("ASSIGNABLE_ORG_ROLE_IDS equals ['owner', 'admin', 'member']", () => {
    expect(ASSIGNABLE_ORG_ROLE_IDS).toEqual(["owner", "admin", "member"]);
  });

  it("ac is exported and defined", () => {
    expect(ac).toBeDefined();
  });

  describe("owner role authorize", () => {
    const role = orgRoles.owner;

    it("can delete organization", () => {
      expect(role.authorize({ organization: ["delete"] }).success).toBe(true);
    });

    it("can update organization", () => {
      expect(role.authorize({ organization: ["update"] }).success).toBe(true);
    });

    it("has all apiKey permissions", () => {
      expect(role.authorize({ apiKey: ["create", "read", "update", "delete"] }).success).toBe(true);
    });

    it("has full contacts permissions", () => {
      expect(role.authorize({ contact: ["read", "create", "update", "delete", "import", "export"] }).success).toBe(true);
    });
  });

  describe("admin role authorize", () => {
    const role = orgRoles.admin;

    it("can update organization but NOT delete", () => {
      expect(role.authorize({ organization: ["update"] }).success).toBe(true);
      expect(role.authorize({ organization: ["delete"] }).success).toBe(false);
    });

    it("has all apiKey permissions", () => {
      expect(role.authorize({ apiKey: ["create", "read", "update", "delete"] }).success).toBe(true);
    });
  });

  describe("member role authorize", () => {
    const role = orgRoles.member;

    it("cannot read apiKey", () => {
      expect(role.authorize({ apiKey: ["read"] }).success).toBe(false);
    });

    it("cannot delete organization", () => {
      expect(role.authorize({ organization: ["delete"] }).success).toBe(false);
    });

    it("can read, create, update contacts but not delete/import/export", () => {
      expect(role.authorize({ contact: ["read", "create", "update"] }).success).toBe(true);
      expect(role.authorize({ contact: ["delete"] }).success).toBe(false);
      expect(role.authorize({ contact: ["import"] }).success).toBe(false);
      expect(role.authorize({ contact: ["export"] }).success).toBe(false);
    });

    it("can only read contactSettings", () => {
      expect(role.authorize({ contactSettings: ["read"] }).success).toBe(true);
      expect(role.authorize({ contactSettings: ["create"] }).success).toBe(false);
    });

    it("has full contactInteraction and contactTask permissions", () => {
      expect(role.authorize({ contactInteraction: ["read", "create", "update", "delete"] }).success).toBe(true);
      expect(role.authorize({ contactTask: ["read", "create", "update", "delete"] }).success).toBe(true);
    });
  });
});
