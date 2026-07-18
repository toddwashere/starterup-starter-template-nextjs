import { describe, it, expect } from "vitest";
import {
  createOrgSchema,
  updateOrgSchema,
  replaceMemberRolesSchema,
  bulkMemberRolesSchema,
  inviteMemberSchema,
  transferOwnershipSchema,
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

describe("updateOrgSchema", () => {
  it("accepts a valid update payload", () => {
    const result = updateOrgSchema.safeParse({
      organizationId: "org_1",
      name: "Acme Inc",
      slug: "acme-inc",
    });
    expect(result.success).toBe(true);
  });

  it("requires organizationId", () => {
    const result = updateOrgSchema.safeParse({
      organizationId: "",
      name: "Acme",
      slug: "acme",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid name and slug the same way as create", () => {
    expect(
      updateOrgSchema.safeParse({
        organizationId: "org_1",
        name: "A",
        slug: "acme",
      }).success,
    ).toBe(false);
    expect(
      updateOrgSchema.safeParse({
        organizationId: "org_1",
        name: "Acme",
        slug: "Acme",
      }).success,
    ).toBe(false);
  });
});

describe("replaceMemberRolesSchema", () => {
  it("accepts a valid payload", () => {
    const result = replaceMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberId: "member_1",
      roles: ["admin", "member"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed organizationId", () => {
    const result = replaceMemberRolesSchema.safeParse({
      organizationId: "",
      memberId: "member_1",
      roles: ["member"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed memberId", () => {
    const result = replaceMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberId: "",
      roles: ["member"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty roles array", () => {
    const result = replaceMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberId: "member_1",
      roles: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown role", () => {
    const result = replaceMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberId: "member_1",
      roles: ["superadmin"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects the owner role (not memberAssignable)", () => {
    const result = replaceMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberId: "member_1",
      roles: ["owner"],
    });
    expect(result.success).toBe(false);
  });
});

describe("bulkMemberRolesSchema", () => {
  it("accepts a valid payload", () => {
    const result = bulkMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberIds: ["member_1", "member_2"],
      operation: "add",
      roles: ["member"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty memberIds array", () => {
    const result = bulkMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberIds: [],
      operation: "add",
      roles: ["member"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects more than 100 memberIds", () => {
    const result = bulkMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberIds: Array.from({ length: 101 }, (_, i) => `member_${i}`),
      operation: "add",
      roles: ["member"],
    });
    expect(result.success).toBe(false);
  });

  it("accepts exactly 100 memberIds", () => {
    const result = bulkMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberIds: Array.from({ length: 100 }, (_, i) => `member_${i}`),
      operation: "add",
      roles: ["member"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid operation", () => {
    const result = bulkMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberIds: ["member_1"],
      operation: "delete",
      roles: ["member"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty roles array", () => {
    const result = bulkMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberIds: ["member_1"],
      operation: "add",
      roles: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown role", () => {
    const result = bulkMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberIds: ["member_1"],
      operation: "add",
      roles: ["superadmin"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects the owner role (not bulkAssignable)", () => {
    const result = bulkMemberRolesSchema.safeParse({
      organizationId: "org_1",
      memberIds: ["member_1"],
      operation: "add",
      roles: ["owner"],
    });
    expect(result.success).toBe(false);
  });
});

describe("inviteMemberSchema", () => {
  it("accepts a valid payload", () => {
    const result = inviteMemberSchema.safeParse({
      organizationId: "org_1",
      email: "user@example.com",
      roles: ["admin"],
    });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = inviteMemberSchema.safeParse({
      organizationId: "org_1",
      email: "not-an-email",
      roles: ["member"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an empty roles array", () => {
    const result = inviteMemberSchema.safeParse({
      organizationId: "org_1",
      email: "user@example.com",
      roles: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects an unknown role", () => {
    const result = inviteMemberSchema.safeParse({
      organizationId: "org_1",
      email: "user@example.com",
      roles: ["superadmin"],
    });
    expect(result.success).toBe(false);
  });

  it("rejects the owner role (not invitationAssignable)", () => {
    const result = inviteMemberSchema.safeParse({
      organizationId: "org_1",
      email: "user@example.com",
      roles: ["owner"],
    });
    expect(result.success).toBe(false);
  });
});

describe("transferOwnershipSchema", () => {
  it("accepts a valid payload", () => {
    const result = transferOwnershipSchema.safeParse({
      organizationId: "org_1",
      targetMemberId: "member_1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects a malformed organizationId", () => {
    const result = transferOwnershipSchema.safeParse({
      organizationId: "",
      targetMemberId: "member_1",
    });
    expect(result.success).toBe(false);
  });

  it("rejects a malformed targetMemberId", () => {
    const result = transferOwnershipSchema.safeParse({
      organizationId: "org_1",
      targetMemberId: "",
    });
    expect(result.success).toBe(false);
  });
});
