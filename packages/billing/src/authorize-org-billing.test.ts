import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: { member: { findFirst: vi.fn() } },
}));

import { prisma } from "@workspace/database";
import { authorizeOrgBilling } from "./authorize-org-billing";

describe("authorizeOrgBilling", () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(["owner", "admin"])("allows %s to manage billing", async (role) => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ role } as never);
    const ok = await authorizeOrgBilling({
      user: { id: "user_1" },
      referenceId: "org_1",
      action: "upgrade-subscription",
    });
    expect(ok).toBe(true);
    expect(prisma.member.findFirst).toHaveBeenCalledWith({
      where: { userId: "user_1", organizationId: "org_1" },
      select: { role: true },
    });
  });

  it("denies a plain member", async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue({ role: "member" } as never);
    const ok = await authorizeOrgBilling({
      user: { id: "user_2" }, referenceId: "org_1", action: "cancel-subscription",
    });
    expect(ok).toBe(false);
  });

  it("denies a non-member (no membership row)", async () => {
    vi.mocked(prisma.member.findFirst).mockResolvedValue(null as never);
    const ok = await authorizeOrgBilling({
      user: { id: "user_3" }, referenceId: "org_1", action: "list-subscription",
    });
    expect(ok).toBe(false);
  });
});
