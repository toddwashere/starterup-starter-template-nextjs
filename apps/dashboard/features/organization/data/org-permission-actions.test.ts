import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/auth/org-permission-context", () => ({
  getOrgPermissionContext: vi.fn(),
}));

import { getOrgPermissionContext } from "@workspace/auth/org-permission-context";
import { getApiKeyManageContextAction } from "./org-permission-actions";

describe("getApiKeyManageContextAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns { canRead: true, canCreate: false } based on permission context results", async () => {
    vi.mocked(getOrgPermissionContext)
      .mockResolvedValueOnce({ allowed: true })  // read call
      .mockResolvedValueOnce({ allowed: false }); // create call

    const result = await getApiKeyManageContextAction("org_123");

    expect(result).toEqual({ canRead: true, canCreate: false });
  });

  it("calls getOrgPermissionContext with { apiKey: ['read'] } and { apiKey: ['create'] } for the given orgId", async () => {
    vi.mocked(getOrgPermissionContext)
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });

    await getApiKeyManageContextAction("org_abc");

    expect(getOrgPermissionContext).toHaveBeenCalledWith("org_abc", { apiKey: ["read"] });
    expect(getOrgPermissionContext).toHaveBeenCalledWith("org_abc", { apiKey: ["create"] });
    expect(getOrgPermissionContext).toHaveBeenCalledTimes(2);
  });
});
