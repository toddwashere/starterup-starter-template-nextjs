import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    user: { findUnique: vi.fn() },
  },
}));

import { prisma } from "@workspace/database";
import { getUserProfileForPublicApi } from "./user-profile";

describe("getUserProfileForPublicApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user fields", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue({
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
      image: null,
    } as never);

    const profile = await getUserProfileForPublicApi("user_1");
    expect(profile).toEqual({
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
      image: null,
    });
    expect(profile).not.toHaveProperty("activeOrganizationId");
  });

  it("returns null when user not found", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);
    expect(await getUserProfileForPublicApi("missing")).toBeNull();
  });
});
