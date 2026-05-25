import { describe, it, expect, vi, beforeEach } from "vitest";

const mockVerify = vi.fn();

vi.mock("@better-auth/oauth-provider/resource-client", () => ({
  oauthProviderResourceClient: () => ({
    getActions: () => ({ verifyAccessToken: mockVerify }),
  }),
}));

vi.mock("../auth", () => ({ auth: {} }));

import { verifyOAuthAccessToken } from "./verify-access-token";

describe("verifyOAuthAccessToken", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns context when JWT is valid", async () => {
    mockVerify.mockResolvedValue({
      sub: "user_1",
      scope: "account:read offline_access",
      client_id: "client_1",
      orgId: "org_1",
    });
    const ctx = await verifyOAuthAccessToken("jwt_token");
    expect(ctx).toEqual({
      userId: "user_1",
      orgId: "org_1",
      scopes: ["account:read", "offline_access"],
      clientId: "client_1",
    });
  });

  it("returns null when verification fails", async () => {
    mockVerify.mockRejectedValue(new Error("invalid"));
    expect(await verifyOAuthAccessToken("bad")).toBeNull();
  });

  it("returns null when sub is missing", async () => {
    mockVerify.mockResolvedValue({ scope: "account:read" });
    expect(await verifyOAuthAccessToken("jwt")).toBeNull();
  });
});
