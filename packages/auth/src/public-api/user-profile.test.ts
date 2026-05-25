import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
    session: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@workspace/database";
import { getUserProfileForPublicApi } from "./user-profile";

describe("getUserProfileForPublicApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user fields and activeOrganizationId from latest session", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
      image: null,
    } as never);
    vi.mocked(prisma.session.findFirst).mockResolvedValue({
      activeOrganizationId: "org_1",
    } as never);

    const profile = await getUserProfileForPublicApi("user_1");
    expect(profile).toEqual({
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
      image: null,
      activeOrganizationId: "org_1",
    });
  });

  it("returns null activeOrganizationId when no session", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user_1",
      name: "Test",
      email: "a@b.c",
      image: null,
    } as never);
    vi.mocked(prisma.session.findFirst).mockResolvedValue(null);

    const profile = await getUserProfileForPublicApi("user_1");
    expect(profile?.activeOrganizationId).toBeNull();
  });

  it("returns null when user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect(await getUserProfileForPublicApi("missing")).toBeNull();
  });
});
