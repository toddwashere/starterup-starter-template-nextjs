import { describe, it, expect } from "vitest";
import { parseOrgRoles } from "./parse-org-roles";

describe("parseOrgRoles", () => {
  it("parses a single role", () => {
    expect(parseOrgRoles("admin")).toEqual(["admin"]);
  });
  it("parses comma-separated roles with spaces", () => {
    expect(parseOrgRoles("admin, member")).toEqual(["admin", "member"]);
  });
  it("drops empty segments", () => {
    expect(parseOrgRoles("admin,,member")).toEqual(["admin", "member"]);
  });
});
