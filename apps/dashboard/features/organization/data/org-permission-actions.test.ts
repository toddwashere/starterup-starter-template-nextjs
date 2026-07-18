import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/auth/org-permission-context", () => ({
  getOrgPermissionContext: vi.fn(),
}));

vi.mock("@workspace/auth/member-role-management", () => ({
  getMemberManagementContext: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ "x-test": "1" })),
}));

import { headers } from "next/headers";
import { getOrgPermissionContext } from "@workspace/auth/org-permission-context";
import {
  getMemberManagementContext,
  type MemberManagementContext,
} from "@workspace/auth/member-role-management";
import {
  getApiKeyManageContextAction,
  getMemberManagementContextAction,
  getOrgUpdateContextAction,
} from "./org-permission-actions";

describe("getOrgUpdateContextAction", () => {
  beforeEach(() => {
    vi.mocked(getOrgPermissionContext).mockReset();
  });

  it("returns whether the actor may update the organization", async () => {
    vi.mocked(getOrgPermissionContext).mockResolvedValue({ allowed: true });

    await expect(getOrgUpdateContextAction("org_1")).resolves.toEqual({
      canUpdate: true,
    });
    expect(getOrgPermissionContext).toHaveBeenCalledWith("org_1", {
      organization: ["update"],
    });
  });
});

describe("getApiKeyManageContextAction", () => {
  beforeEach(() => {
    vi.mocked(getOrgPermissionContext).mockReset();
  });

  it("returns { canRead: true, canCreate: false } based on permission context results", async () => {
    vi.mocked(getOrgPermissionContext)
      .mockResolvedValueOnce({ allowed: true }) // read call
      .mockResolvedValueOnce({ allowed: false }); // create call

    const result = await getApiKeyManageContextAction("org_123");

    expect(result).toEqual({ canRead: true, canCreate: false });
  });

  it("calls getOrgPermissionContext with { apiKey: ['read'] } and { apiKey: ['create'] } for the given orgId", async () => {
    vi.mocked(getOrgPermissionContext)
      .mockResolvedValueOnce({ allowed: true })
      .mockResolvedValueOnce({ allowed: false });

    await getApiKeyManageContextAction("org_abc");

    expect(getOrgPermissionContext).toHaveBeenCalledWith("org_abc", {
      apiKey: ["read"],
    });
    expect(getOrgPermissionContext).toHaveBeenCalledWith("org_abc", {
      apiKey: ["create"],
    });
    expect(getOrgPermissionContext).toHaveBeenCalledTimes(2);
  });
});

describe("getMemberManagementContextAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to getMemberManagementContext with awaited headers, organizationId, and memberIds", async () => {
    const context: MemberManagementContext = {
      canManageMembers: true,
      actorRoles: ["admin"],
      members: {
        member_1: { allowed: true, reason: null, canTransferOwnership: false },
      },
    };
    vi.mocked(getMemberManagementContext).mockResolvedValueOnce(context);

    const result = await getMemberManagementContextAction("org_abc", ["member_1"]);

    expect(headers).toHaveBeenCalled();
    expect(getMemberManagementContext).toHaveBeenCalledWith(
      expect.any(Headers),
      "org_abc",
      ["member_1"],
    );
    expect(getMemberManagementContext).toHaveBeenCalledTimes(1);
    expect(result).toEqual(context);
  });

  it("returns the context object as-is (allowed:false members included)", async () => {
    const context: MemberManagementContext = {
      canManageMembers: false,
      actorRoles: ["member"],
      members: {
        member_2: {
          allowed: false,
          reason: "MISSING_PERMISSION",
          canTransferOwnership: false,
        },
      },
    };
    vi.mocked(getMemberManagementContext).mockResolvedValueOnce(context);

    const result = await getMemberManagementContextAction("org_123", ["member_2"]);

    expect(result).toEqual(context);
  });
});
