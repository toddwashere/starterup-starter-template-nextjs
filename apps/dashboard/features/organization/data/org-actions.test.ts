import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/auth", () => ({
  auth: {
    api: {
      createOrganization: vi.fn(),
      updateOrganization: vi.fn(),
      removeMember: vi.fn(),
      cancelInvitation: vi.fn(),
    },
  },
}));

vi.mock("@workspace/auth/guards", () => ({
  requireOrgPermission: vi.fn().mockResolvedValue({
    user: { id: "user_1" },
    session: { activeOrganizationId: "org_1" },
  }),
  requireUser: vi.fn().mockResolvedValue({
    user: { id: "user_1" },
    session: { activeOrganizationId: "org_1" },
  }),
}));

vi.mock("@workspace/auth/member-role-management", () => {
  // The real module imports `@workspace/database` (Prisma) at module scope,
  // which requires env vars this test process doesn't set. Define a
  // structurally-equivalent error class here instead of `vi.importActual`
  // so `instanceof` checks still hold — `org-actions.ts` resolves the same
  // mocked module for its `MemberRoleManagementError` import.
  class MemberRoleManagementError extends Error {
    code: string;
    constructor(code: string, message: string) {
      super(message);
      this.code = code;
    }
  }
  return {
    MemberRoleManagementError,
    replaceMemberRoles: vi.fn(),
    mutateMemberRoles: vi.fn(),
    inviteMemberWithRoles: vi.fn(),
    transferOrganizationOwnership: vi.fn(),
    getMemberManagementContext: vi.fn(),
  };
});

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers({ "x-test": "1" })),
}));

vi.mock("@workspace/observability/capture", () => ({
  captureException: vi.fn(),
}));

import { auth } from "@workspace/auth";
import { requireOrgPermission } from "@workspace/auth/guards";
import { headers } from "next/headers";
import { captureException } from "@workspace/observability/capture";
import {
  replaceMemberRoles,
  mutateMemberRoles,
  inviteMemberWithRoles,
  transferOrganizationOwnership,
  MemberRoleManagementError,
} from "@workspace/auth/member-role-management";
import { InvalidOrgRoleSetError } from "@workspace/auth/org-roles";
import {
  replaceMemberRolesAction,
  bulkMemberRolesAction,
  inviteMemberAction,
  transferOwnershipAction,
  updateOrganizationAction,
} from "./org-actions";

const mockUpdateOrganization = vi.mocked(auth.api.updateOrganization);

describe("updateOrganizationAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns INVALID_INPUT for a malformed payload without calling auth", async () => {
    const result = await updateOrganizationAction({
      organizationId: "org_1",
      name: "A",
      slug: "acme",
    });
    expect(result).toEqual({
      success: false,
      error: { code: "INVALID_INPUT", message: "Check the organization details." },
    });
    expect(mockUpdateOrganization).not.toHaveBeenCalled();
  });

  it("requires organization:update and updates name and slug", async () => {
    mockUpdateOrganization.mockResolvedValue({
      id: "org_1",
      name: "Acme Renamed",
      slug: "acme-renamed",
    } as never);

    const result = await updateOrganizationAction({
      organizationId: "org_1",
      name: "Acme Renamed",
      slug: "acme-renamed",
    });

    expect(requireOrgPermission).toHaveBeenCalledWith({
      organization: ["update"],
    });
    expect(mockUpdateOrganization).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: {
        organizationId: "org_1",
        data: { name: "Acme Renamed", slug: "acme-renamed" },
      },
    });
    expect(result).toEqual({
      success: true,
      data: {
        id: "org_1",
        name: "Acme Renamed",
        slug: "acme-renamed",
      },
    });
  });

  it("maps slug-taken errors to SLUG_TAKEN", async () => {
    mockUpdateOrganization.mockRejectedValue(
      new Error("organization slug already taken"),
    );

    const result = await updateOrganizationAction({
      organizationId: "org_1",
      name: "Acme",
      slug: "taken-slug",
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: "SLUG_TAKEN",
        message:
          "This URL slug is already taken. Choose a different slug for your organization.",
      },
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("maps forbidden errors without capturing", async () => {
    vi.mocked(requireOrgPermission).mockRejectedValueOnce(
      new Error("Forbidden: missing required permission", {
        cause: { status: 403 },
      }),
    );

    const result = await updateOrganizationAction({
      organizationId: "org_1",
      name: "Acme",
      slug: "acme",
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: "FORBIDDEN",
        message: "You do not have permission to update this organization.",
      },
    });
    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("replaceMemberRolesAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns INVALID_INPUT for a malformed payload without calling the service", async () => {
    const result = await replaceMemberRolesAction({
      organizationId: "org_1",
      memberId: "member_1",
      roles: [],
    });

    expect(result).toEqual({
      success: false,
      error: { code: "INVALID_INPUT", message: expect.any(String) },
    });
    expect(replaceMemberRoles).not.toHaveBeenCalled();
  });

  it("parses input, forwards awaited headers, and keeps the explicit organizationId", async () => {
    vi.mocked(replaceMemberRoles).mockResolvedValue({
      memberId: "member_1",
      status: "updated",
      roles: ["admin"],
    });

    const result = await replaceMemberRolesAction({
      organizationId: "org_1",
      memberId: "member_1",
      roles: ["admin"],
    });

    expect(headers).toHaveBeenCalled();
    expect(replaceMemberRoles).toHaveBeenCalledWith({
      organizationId: "org_1",
      memberId: "member_1",
      roles: ["admin"],
      headers: expect.any(Headers),
    });
    expect(result).toEqual({
      success: true,
      data: { memberId: "member_1", status: "updated", roles: ["admin"] },
    });
  });

  it("returns success:true wrapping an in-band 'failed' outcome (expected denial)", async () => {
    vi.mocked(replaceMemberRoles).mockResolvedValue({
      memberId: "member_1",
      status: "failed",
      code: "SAME_OR_HIGHER_RANK",
      message: "You cannot manage a member at the same or a higher rank than you.",
    });

    const result = await replaceMemberRolesAction({
      organizationId: "org_1",
      memberId: "member_1",
      roles: ["admin"],
    });

    expect(result).toEqual({
      success: true,
      data: {
        memberId: "member_1",
        status: "failed",
        code: "SAME_OR_HIGHER_RANK",
        message: "You cannot manage a member at the same or a higher rank than you.",
      },
    });
  });

  it("maps a thrown MemberRoleManagementError to a typed error", async () => {
    vi.mocked(replaceMemberRoles).mockRejectedValue(
      new MemberRoleManagementError("UNAUTHENTICATED", "You must be signed in."),
    );

    const result = await replaceMemberRolesAction({
      organizationId: "org_1",
      memberId: "member_1",
      roles: ["admin"],
    });

    expect(result).toEqual({
      success: false,
      error: { code: "UNAUTHENTICATED", message: "You must be signed in." },
    });
  });

  it("maps a thrown InvalidOrgRoleSetError to a typed error", async () => {
    vi.mocked(replaceMemberRoles).mockRejectedValue(
      new InvalidOrgRoleSetError("UNKNOWN_ROLE", "Role configuration is out of date."),
    );

    const result = await replaceMemberRolesAction({
      organizationId: "org_1",
      memberId: "member_1",
      roles: ["admin"],
    });

    expect(result).toEqual({
      success: false,
      error: { code: "UNKNOWN_ROLE", message: "Role configuration is out of date." },
    });
  });

  it("maps an unexpected exception to a generic UPDATE_FAILED error without leaking its message", async () => {
    vi.mocked(replaceMemberRoles).mockRejectedValue(new Error("db connection reset by peer"));

    const result = await replaceMemberRolesAction({
      organizationId: "org_1",
      memberId: "member_1",
      roles: ["admin"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UPDATE_FAILED");
      expect(result.error.message).not.toContain("db connection reset by peer");
    }
  });
});

describe("bulkMemberRolesAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns INVALID_INPUT for an oversized memberIds array", async () => {
    const result = await bulkMemberRolesAction({
      organizationId: "org_1",
      memberIds: Array.from({ length: 101 }, (_, i) => `member_${i}`),
      operation: "add",
      roles: ["member"],
    });

    expect(result).toEqual({
      success: false,
      error: { code: "INVALID_INPUT", message: expect.any(String) },
    });
    expect(mutateMemberRoles).not.toHaveBeenCalled();
  });

  it("parses input and forwards awaited headers with the explicit organizationId", async () => {
    vi.mocked(mutateMemberRoles).mockResolvedValue({
      outcomes: [{ memberId: "member_1", status: "updated", roles: ["member"] }],
    });

    const result = await bulkMemberRolesAction({
      organizationId: "org_1",
      memberIds: ["member_1"],
      operation: "add",
      roles: ["member"],
    });

    expect(headers).toHaveBeenCalled();
    expect(mutateMemberRoles).toHaveBeenCalledWith({
      organizationId: "org_1",
      memberIds: ["member_1"],
      operation: "add",
      roles: ["member"],
      headers: expect.any(Headers),
    });
    expect(result).toEqual({
      success: true,
      data: { outcomes: [{ memberId: "member_1", status: "updated", roles: ["member"] }] },
    });
  });

  it("maps a thrown MemberRoleManagementError to a typed error", async () => {
    vi.mocked(mutateMemberRoles).mockRejectedValue(
      new MemberRoleManagementError("NOT_A_MEMBER", "You are not a member of this organization."),
    );

    const result = await bulkMemberRolesAction({
      organizationId: "org_1",
      memberIds: ["member_1"],
      operation: "add",
      roles: ["member"],
    });

    expect(result).toEqual({
      success: false,
      error: { code: "NOT_A_MEMBER", message: "You are not a member of this organization." },
    });
  });

  it("maps an unexpected exception to a generic UPDATE_FAILED error", async () => {
    vi.mocked(mutateMemberRoles).mockRejectedValue(new Error("boom"));

    const result = await bulkMemberRolesAction({
      organizationId: "org_1",
      memberIds: ["member_1"],
      operation: "add",
      roles: ["member"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UPDATE_FAILED");
      expect(result.error.message).not.toContain("boom");
    }
  });
});

describe("inviteMemberAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns INVALID_INPUT for an invalid email", async () => {
    const result = await inviteMemberAction({
      organizationId: "org_1",
      email: "not-an-email",
      roles: ["admin"],
    });

    expect(result).toEqual({
      success: false,
      error: { code: "INVALID_INPUT", message: expect.any(String) },
    });
    expect(inviteMemberWithRoles).not.toHaveBeenCalled();
  });

  it("forwards a role ARRAY (not a single role) and the explicit organizationId", async () => {
    vi.mocked(inviteMemberWithRoles).mockResolvedValue({
      id: "invitation_1",
    } as unknown as Awaited<ReturnType<typeof inviteMemberWithRoles>>);

    const result = await inviteMemberAction({
      organizationId: "org_1",
      email: "user@example.com",
      roles: ["admin", "member"],
    });

    expect(headers).toHaveBeenCalled();
    expect(inviteMemberWithRoles).toHaveBeenCalledWith({
      organizationId: "org_1",
      email: "user@example.com",
      roles: ["admin", "member"],
      headers: expect.any(Headers),
    });
    expect(result).toEqual({ success: true, data: { id: "invitation_1" } });
  });

  it("maps a thrown MemberRoleManagementError to a typed error (expected denial)", async () => {
    vi.mocked(inviteMemberWithRoles).mockRejectedValue(
      new MemberRoleManagementError("MISSING_PERMISSION", "You do not have permission to invite members."),
    );

    const result = await inviteMemberAction({
      organizationId: "org_1",
      email: "user@example.com",
      roles: ["admin"],
    });

    expect(result).toEqual({
      success: false,
      error: { code: "MISSING_PERMISSION", message: "You do not have permission to invite members." },
    });
  });

  it("maps a thrown InvalidOrgRoleSetError to a typed error", async () => {
    vi.mocked(inviteMemberWithRoles).mockRejectedValue(
      new InvalidOrgRoleSetError("EMPTY_ROLE_SET", "Select at least one role."),
    );

    const result = await inviteMemberAction({
      organizationId: "org_1",
      email: "user@example.com",
      roles: ["admin"],
    });

    expect(result).toEqual({
      success: false,
      error: { code: "EMPTY_ROLE_SET", message: "Select at least one role." },
    });
  });

  it("maps an unexpected exception to a generic UPDATE_FAILED error AND captures it with the operation label", async () => {
    const unexpected = new Error("smtp exploded");
    vi.mocked(inviteMemberWithRoles).mockRejectedValue(unexpected);

    const result = await inviteMemberAction({
      organizationId: "org_1",
      email: "user@example.com",
      roles: ["admin"],
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UPDATE_FAILED");
      expect(result.error.message).not.toContain("smtp exploded");
    }
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      unexpected,
      expect.objectContaining({ operation: "member-role-invite" }),
    );
    // The captured context must not leak the invitee email or role payload.
    const [, context] = vi.mocked(captureException).mock.calls[0]!;
    expect(JSON.stringify(context)).not.toContain("user@example.com");
    expect(JSON.stringify(context)).not.toContain("admin");
  });

  it("does NOT capture an expected MemberRoleManagementError", async () => {
    vi.mocked(inviteMemberWithRoles).mockRejectedValue(
      new MemberRoleManagementError("MISSING_PERMISSION", "You do not have permission to invite members."),
    );

    await inviteMemberAction({
      organizationId: "org_1",
      email: "user@example.com",
      roles: ["admin"],
    });

    expect(captureException).not.toHaveBeenCalled();
  });
});

describe("transferOwnershipAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns INVALID_INPUT for a malformed payload", async () => {
    const result = await transferOwnershipAction({
      organizationId: "org_1",
      targetMemberId: "",
    });

    expect(result).toEqual({
      success: false,
      error: { code: "INVALID_INPUT", message: expect.any(String) },
    });
    expect(transferOrganizationOwnership).not.toHaveBeenCalled();
  });

  it("delegates to the atomic transfer service with awaited headers and explicit organizationId", async () => {
    vi.mocked(transferOrganizationOwnership).mockResolvedValue({
      previousOwnerRoles: ["admin"],
      newOwnerRoles: ["owner", "member"],
    });

    const result = await transferOwnershipAction({
      organizationId: "org_1",
      targetMemberId: "member_2",
    });

    expect(headers).toHaveBeenCalled();
    expect(transferOrganizationOwnership).toHaveBeenCalledWith({
      organizationId: "org_1",
      targetMemberId: "member_2",
      headers: expect.any(Headers),
    });
    expect(result).toEqual({
      success: true,
      data: { previousOwnerRoles: ["admin"], newOwnerRoles: ["owner", "member"] },
    });
  });

  it("maps a thrown MemberRoleManagementError to a typed error (expected denial) WITHOUT capturing it", async () => {
    vi.mocked(transferOrganizationOwnership).mockRejectedValue(
      new MemberRoleManagementError(
        "SELF",
        "You cannot remove your highest role from yourself.",
      ),
    );

    const result = await transferOwnershipAction({
      organizationId: "org_1",
      targetMemberId: "member_2",
    });

    expect(result).toEqual({
      success: false,
      error: {
        code: "SELF",
        message: "You cannot remove your highest role from yourself.",
      },
    });
    // Expected authorization outcomes are NOT incidents — never captured.
    expect(captureException).not.toHaveBeenCalled();
  });

  it("does NOT capture an expected InvalidOrgRoleSetError", async () => {
    vi.mocked(transferOrganizationOwnership).mockRejectedValue(
      new InvalidOrgRoleSetError("UNKNOWN_ROLE", "Role configuration is out of date."),
    );

    const result = await transferOwnershipAction({
      organizationId: "org_1",
      targetMemberId: "member_2",
    });

    expect(result).toEqual({
      success: false,
      error: { code: "UNKNOWN_ROLE", message: "Role configuration is out of date." },
    });
    expect(captureException).not.toHaveBeenCalled();
  });

  it("maps an unexpected exception to a generic UPDATE_FAILED error AND captures it with the operation label", async () => {
    const unexpected = new Error("tx aborted");
    vi.mocked(transferOrganizationOwnership).mockRejectedValue(unexpected);

    const result = await transferOwnershipAction({
      organizationId: "org_1",
      targetMemberId: "member_2",
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe("UPDATE_FAILED");
      expect(result.error.message).not.toContain("tx aborted");
    }
    expect(captureException).toHaveBeenCalledTimes(1);
    expect(captureException).toHaveBeenCalledWith(
      unexpected,
      expect.objectContaining({ operation: "member-role-transfer" }),
    );
  });
});
