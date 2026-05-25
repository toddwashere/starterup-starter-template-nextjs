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

  it("returns role when member exists", async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ role: "admin" } as never);
    const role = await assertUserOrgMember("user_1", "org_1");
    expect(role).toBe("admin");
  });

  it("throws FORBIDDEN when not a member", async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null);
    await expect(assertUserOrgMember("user_1", "org_2")).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});

describe("listOrganizationsForUser", () => {
  it("returns mapped org rows", async () => {
    vi.mocked(prisma.member.findMany).mockResolvedValue([
      {
        role: "member",
        organization: { id: "org_1", name: "Acme", slug: "acme" },
      },
    ] as never);
    const rows = await listOrganizationsForUser("user_1");
    expect(rows).toEqual([
      { id: "org_1", name: "Acme", slug: "acme", role: "member" },
    ]);
  });
});
