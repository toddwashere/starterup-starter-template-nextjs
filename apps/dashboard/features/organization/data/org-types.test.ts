import { describe, it, expect } from "vitest";
import {
  createOrgSchema,
  inviteMemberSchema,
  updateMemberRoleSchema,
} from "./org-types";

describe("createOrgSchema", () => {
  it("accepts valid org input", () => {
    const result = createOrgSchema.safeParse({ name: "Acme Inc", slug: "acme-inc" });
    expect(result.success).toBe(true);
  });

  it("rejects name shorter than 2 characters", () => {
    const result = createOrgSchema.safeParse({ name: "A", slug: "acme" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Name must be at least 2 characters");
  });

  it("rejects name longer than 50 characters", () => {
    const result = createOrgSchema.safeParse({ name: "A".repeat(51), slug: "acme" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Name must be at most 50 characters");
  });

  it("rejects slug with uppercase letters", () => {
    const result = createOrgSchema.safeParse({ name: "Acme", slug: "Acme" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toContain("lowercase");
  });

  it("rejects slug with spaces", () => {
    const result = createOrgSchema.safeParse({ name: "Acme", slug: "acme inc" });
    expect(result.success).toBe(false);
  });

  it("accepts slug with hyphens and numbers", () => {
    const result = createOrgSchema.safeParse({ name: "Acme 2", slug: "acme-2" });
    expect(result.success).toBe(true);
  });

  it("rejects slug shorter than 2 characters", () => {
    const result = createOrgSchema.safeParse({ name: "Acme", slug: "a" });
    expect(result.success).toBe(false);
  });
});

describe("inviteMemberSchema", () => {
  it("accepts valid invite input", () => {
    const result = inviteMemberSchema.safeParse({ email: "user@example.com", role: "member" });
    expect(result.success).toBe(true);
  });

  it("accepts admin role", () => {
    const result = inviteMemberSchema.safeParse({ email: "user@example.com", role: "admin" });
    expect(result.success).toBe(true);
  });

  it("rejects invalid email", () => {
    const result = inviteMemberSchema.safeParse({ email: "not-an-email", role: "member" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Invalid email address");
  });

  it("rejects owner role (only admin/member allowed for invites)", () => {
    const result = inviteMemberSchema.safeParse({ email: "user@example.com", role: "owner" });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Role must be admin or member");
  });

  it("rejects unknown role", () => {
    const result = inviteMemberSchema.safeParse({ email: "user@example.com", role: "superadmin" });
    expect(result.success).toBe(false);
  });
});

describe("updateMemberRoleSchema", () => {
  it("accepts a single role array", () => {
    const result = updateMemberRoleSchema.safeParse({ memberId: "abc123", role: ["admin"] });
    expect(result.success).toBe(true);
  });

  it("accepts multiple roles", () => {
    const result = updateMemberRoleSchema.safeParse({ memberId: "abc123", role: ["owner", "member"] });
    expect(result.success).toBe(true);
  });

  it("accepts owner role for updates", () => {
    const result = updateMemberRoleSchema.safeParse({ memberId: "abc123", role: ["owner"] });
    expect(result.success).toBe(true);
  });

  it("rejects empty memberId", () => {
    const result = updateMemberRoleSchema.safeParse({ memberId: "", role: ["member"] });
    expect(result.success).toBe(false);
  });

  it("rejects an empty role array", () => {
    const result = updateMemberRoleSchema.safeParse({ memberId: "abc", role: [] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe("Select at least one role");
  });

  it("rejects invalid role", () => {
    const result = updateMemberRoleSchema.safeParse({ memberId: "abc", role: ["superadmin"] });
    expect(result.success).toBe(false);
  });
});
