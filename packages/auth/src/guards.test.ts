import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("next/headers", () => ({
  headers: vi.fn(() => Promise.resolve(new Headers())),
}));

vi.mock("./auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
      hasPermission: vi.fn(),
    },
  },
}));

import {
  requireUser,
  requireSystemAdmin,
  requireOrgPermission,
  requireOrgPermissionWithActiveOrg,
} from "./guards";
import { auth } from "./auth";
import { buildUser } from "@workspace/test-utils/factories";

const mockGetSession = vi.mocked(auth.api.getSession);
const mockHasPermission = vi.mocked(auth.api.hasPermission);

const user = buildUser({ id: "u1", email: "test@example.com", name: "Test User" });

const fakeSession = {
  user: {
    ...user,
    role: "user" as string,
  },
  session: {
    id: "s1",
    token: "tok_abc",
    userId: user.id,
    expiresAt: new Date(Date.now() + 86400000),
    createdAt: new Date(),
    updatedAt: new Date(),
  },
};

describe("requireUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session when authenticated", async () => {
    mockGetSession.mockResolvedValue(fakeSession as never);

    const result = await requireUser();
    expect(result).toEqual(fakeSession);
    expect(mockGetSession).toHaveBeenCalledOnce();
  });

  it("throws 401 when no session exists", async () => {
    mockGetSession.mockResolvedValue(null as never);

    await expect(requireUser()).rejects.toThrow("Unauthorized");
    await expect(requireUser()).rejects.toThrow(
      expect.objectContaining({ cause: { status: 401 } }),
    );
  });
});

describe("requireSystemAdmin", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session when user.role is 'admin'", async () => {
    const adminSession = {
      ...fakeSession,
      user: { ...fakeSession.user, role: "admin" },
    };
    mockGetSession.mockResolvedValue(adminSession as never);

    const result = await requireSystemAdmin();
    expect(result).toEqual(adminSession);
  });

  it("throws 403 when user.role is 'user'", async () => {
    mockGetSession.mockResolvedValue(fakeSession as never);

    await expect(requireSystemAdmin()).rejects.toThrow(
      "Forbidden: admin role required",
    );
    await expect(requireSystemAdmin()).rejects.toThrow(
      expect.objectContaining({ cause: { status: 403 } }),
    );
  });

  it("throws 401 when not authenticated at all", async () => {
    mockGetSession.mockResolvedValue(null as never);

    await expect(requireSystemAdmin()).rejects.toThrow("Unauthorized");
  });
});

describe("requireOrgPermission", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session when user has the required permission", async () => {
    mockGetSession.mockResolvedValue(fakeSession as never);
    mockHasPermission.mockResolvedValue({ success: true } as never);

    const result = await requireOrgPermission({ member: ["create"] });
    expect(result).toEqual(fakeSession);
    expect(mockHasPermission).toHaveBeenCalledOnce();
  });

  it("throws 403 when user lacks the required permission", async () => {
    mockGetSession.mockResolvedValue(fakeSession as never);
    mockHasPermission.mockResolvedValue({ success: false } as never);

    await expect(
      requireOrgPermission({ organization: ["delete"] }),
    ).rejects.toThrow("Forbidden: missing required permission");
  });

  it("throws 403 when hasPermission returns null", async () => {
    mockGetSession.mockResolvedValue(fakeSession as never);
    mockHasPermission.mockResolvedValue(null as never);

    await expect(
      requireOrgPermission({ billing: ["manage"] }),
    ).rejects.toThrow("Forbidden: missing required permission");
  });

  it("throws 401 when not authenticated", async () => {
    mockGetSession.mockResolvedValue(null as never);

    await expect(
      requireOrgPermission({ member: ["create"] }),
    ).rejects.toThrow("Unauthorized");
  });
});

describe("requireOrgPermissionWithActiveOrg", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns session and active organization id when present", async () => {
    const sessionWithActiveOrg = {
      ...fakeSession,
      session: {
        ...fakeSession.session,
        activeOrganizationId: "org_1",
      },
    };
    mockGetSession.mockResolvedValue(sessionWithActiveOrg as never);
    mockHasPermission.mockResolvedValue({ success: true } as never);

    const result = await requireOrgPermissionWithActiveOrg({
      apiKey: ["create"],
    });

    expect(result).toEqual({
      session: sessionWithActiveOrg,
      activeOrganizationId: "org_1",
    });
  });

  it("throws 400 when no active organization is selected", async () => {
    mockGetSession.mockResolvedValue(fakeSession as never);
    mockHasPermission.mockResolvedValue({ success: true } as never);

    await expect(
      requireOrgPermissionWithActiveOrg({ apiKey: ["read"] }),
    ).rejects.toThrow("No active organization selected");
    await expect(
      requireOrgPermissionWithActiveOrg({ apiKey: ["read"] }),
    ).rejects.toThrow(expect.objectContaining({ cause: { status: 400 } }));
  });
});
