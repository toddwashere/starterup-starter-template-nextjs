import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    member: { findFirst: vi.fn(), findMany: vi.fn() },
  },
}));

import { prisma } from "@workspace/database";
import {
  assertUserOrgMember,
  listOrganizationsForUser,
  PublicApiOrgError,
} from "./org-membership";

describe("assertUserOrgMember", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns roles array when member exists (single role)", async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ role: "admin" } as never);
    const roles = await assertUserOrgMember("user_1", "org_1");
    expect(roles).toEqual(["admin"]);
  });

  it("returns roles array when member has CSV roles", async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ role: "admin,member" } as never);
    const roles = await assertUserOrgMember("user_1", "org_1");
    expect(roles).toEqual(["admin", "member"]);
  });

  it("throws FORBIDDEN when not a member", async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null);
    await expect(assertUserOrgMember("user_1", "org_2")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("listOrganizationsForUser", () => {
  it("returns mapped org rows with roles array", async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      {
        role: "member",
        organization: { id: "org_1", name: "Acme", slug: "acme" },
      },
    ] as never);
    const rows = await listOrganizationsForUser("user_1");
    expect(rows).toEqual([
      { id: "org_1", name: "Acme", slug: "acme", roles: ["member"] },
    ]);
  });

  it("returns mapped org rows with multiple roles from CSV", async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      {
        role: "admin,member",
        organization: { id: "org_2", name: "Beta Corp", slug: "beta-corp" },
      },
    ] as never);
    const rows = await listOrganizationsForUser("user_1");
    expect(rows).toEqual([
      { id: "org_2", name: "Beta Corp", slug: "beta-corp", roles: ["admin", "member"] },
    ]);
  });
});
