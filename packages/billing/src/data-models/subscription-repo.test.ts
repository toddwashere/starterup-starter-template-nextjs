import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    subscription: {
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@workspace/database";
import { getActiveSubscriptionForOrg } from "./subscription-repo";

describe("subscription-repo", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the latest active/trialing subscription for the org", async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue({
      id: "sub_1", referenceId: "org_1", status: "active",
    } as never);
    const sub = await getActiveSubscriptionForOrg("org_1");
    expect(prisma.subscription.findFirst).toHaveBeenCalledWith({
      where: { referenceId: "org_1", status: { in: ["active", "trialing"] } },
      orderBy: { periodEnd: "desc" },
    });
    expect(sub?.id).toBe("sub_1");
  });

  it("returns null when no active/trialing subscription exists", async () => {
    vi.mocked(prisma.subscription.findFirst).mockResolvedValue(null as never);
    const sub = await getActiveSubscriptionForOrg("org_2");
    expect(sub).toBeNull();
  });
});
