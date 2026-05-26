import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock("./auth", () => ({
  auth: {
    api: {
      hasPermission: vi.fn(),
    },
  },
}));

import { getOrgPermissionContext } from "./org-permission-context";
import { auth } from "./auth";

const mockHasPermission = vi.mocked(auth.api.hasPermission);

const orgId = "org_123";
const permissions = { apiKey: ["create"] };

describe("getOrgPermissionContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns { allowed: true } when hasPermission resolves { success: true }", async () => {
    mockHasPermission.mockResolvedValue({ success: true } as never);

    const result = await getOrgPermissionContext(orgId, permissions);

    expect(result).toEqual({ allowed: true });
  });

  it("returns { allowed: false } when hasPermission resolves { success: false }", async () => {
    mockHasPermission.mockResolvedValue({ success: false } as never);

    const result = await getOrgPermissionContext(orgId, permissions);

    expect(result).toEqual({ allowed: false });
  });

  it("returns { allowed: false } when hasPermission resolves undefined", async () => {
    mockHasPermission.mockResolvedValue(undefined as never);

    const result = await getOrgPermissionContext(orgId, permissions);

    expect(result).toEqual({ allowed: false });
  });

  it("returns { allowed: false } when hasPermission resolves null", async () => {
    mockHasPermission.mockResolvedValue(null as never);

    const result = await getOrgPermissionContext(orgId, permissions);

    expect(result).toEqual({ allowed: false });
  });

  it("returns { allowed: false } when hasPermission throws", async () => {
    mockHasPermission.mockRejectedValue(new Error("Network error"));

    const result = await getOrgPermissionContext(orgId, permissions);

    expect(result).toEqual({ allowed: false });
  });

  it("passes organizationId and permissions in the request body", async () => {
    mockHasPermission.mockResolvedValue({ success: true } as never);

    await getOrgPermissionContext(orgId, permissions);

    expect(mockHasPermission).toHaveBeenCalledWith(
      expect.objectContaining({
        body: { organizationId: orgId, permissions },
      }),
    );
  });
});
