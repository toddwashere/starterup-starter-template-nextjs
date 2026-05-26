import { describe, it, expect } from "vitest";
import { memberRoleFieldHasPermission } from "./member-permissions";

describe("memberRoleFieldHasPermission", () => {
  it("admin,member CSV → true for apiKey read (admin grants it)", () => {
    expect(memberRoleFieldHasPermission("admin,member", { apiKey: ["read"] })).toBe(true);
  });

  it("member alone → false for apiKey create (member lacks it)", () => {
    expect(memberRoleFieldHasPermission("member", { apiKey: ["create"] })).toBe(false);
  });

  it("member alone → true for contact read (member has it)", () => {
    expect(memberRoleFieldHasPermission("member", { contact: ["read"] })).toBe(true);
  });

  it("owner single role → true for organization delete", () => {
    expect(memberRoleFieldHasPermission("owner", { organization: ["delete"] })).toBe(true);
  });

  it("member,admin CSV → true for organization update (admin provides it, order-independent)", () => {
    expect(memberRoleFieldHasPermission("member,admin", { organization: ["update"] })).toBe(true);
  });

  it("unknown role id is ignored gracefully → false", () => {
    expect(memberRoleFieldHasPermission("bogus", { apiKey: ["read"] })).toBe(false);
  });

  it("empty string → false", () => {
    expect(memberRoleFieldHasPermission("", { apiKey: ["read"] })).toBe(false);
  });

  it("whitespace-only string → false", () => {
    expect(memberRoleFieldHasPermission("   ", { apiKey: ["read"] })).toBe(false);
  });
});
