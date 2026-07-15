import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("./auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
      hasPermission: vi.fn(),
      updateMemberRole: vi.fn(),
    },
  },
}));

vi.mock("@workspace/database", () => ({
  prisma: {
    member: { findFirst: vi.fn() },
  },
}));

vi.mock("@workspace/observability/capture", () => ({
  captureException: vi.fn(),
}));

import { auth } from "./auth";
import { prisma } from "@workspace/database";
import { captureException } from "@workspace/observability/capture";
import {
  replaceMemberRoles,
  mutateMemberRoles,
  getMemberManagementContext,
  MemberRoleManagementError,
} from "./member-role-management";

const mockGetSession = vi.mocked(auth.api.getSession);
const mockHasPermission = vi.mocked(auth.api.hasPermission);
const mockUpdateMemberRole = vi.mocked(auth.api.updateMemberRole);
const mockFindFirst = vi.mocked(prisma.member.findFirst);
const mockCaptureException = vi.mocked(captureException);

type FakeMember = {
  id: string;
  organizationId: string;
  userId: string;
  role: string;
};

let mockActor: FakeMember;
let mockTarget: FakeMember;

type MemberFinder = (args: {
  where: Record<string, unknown>;
}) => Promise<FakeMember | null>;

// prisma.member.findFirst's real return type is a lazy Prisma__MemberClient,
// not a plain Promise; the mock only needs to satisfy the awaited shape the
// service consumes, so implementations are cast through `never` at the
// mockImplementation boundary (matching this repo's existing `as never`
// convention for typed Better Auth / Prisma mocks).
function installFindFirst(impl: MemberFinder) {
  mockFindFirst.mockImplementation(impl as never);
}

function installDefaultFindFirst() {
  installFindFirst(async ({ where }) => {
    if ("id" in where) {
      return where.id === mockTarget.id && where.organizationId === mockTarget.organizationId
        ? { ...mockTarget }
        : null;
    }
    if ("userId" in where) {
      return where.userId === mockActor.userId && where.organizationId === mockActor.organizationId
        ? { ...mockActor }
        : null;
    }
    return null;
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockActor = { id: "member_1", organizationId: "org_1", userId: "user_actor", role: "owner" };
  mockTarget = { id: "member_2", organizationId: "org_1", userId: "user_target", role: "member" };

  mockGetSession.mockResolvedValue({
    user: { id: "user_actor", email: "actor@example.com" },
    session: { id: "s1" },
  } as never);
  mockHasPermission.mockResolvedValue({ success: true } as never);
  mockUpdateMemberRole.mockResolvedValue({
    member: { id: "member_2", userId: "user_target", organizationId: "org_1", role: "admin" },
  } as never);

  installDefaultFindFirst();
});

describe("replaceMemberRoles", () => {
  it("scopes actor and target lookups to the explicit organization", async () => {
    await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["member"],
    });

    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { organizationId: "org_1", userId: "user_actor" },
    });
    expect(mockFindFirst).toHaveBeenCalledWith({
      where: { id: "member_2", organizationId: "org_1" },
    });
  });

  it("reloads the target immediately before writing", async () => {
    mockTarget.role = "member";
    await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["admin"],
    });

    const findFirstOrder = mockFindFirst.mock.invocationCallOrder;
    const updateOrder = mockUpdateMemberRole.mock.invocationCallOrder;
    expect(findFirstOrder.length).toBeGreaterThan(0);
    expect(updateOrder.length).toBeGreaterThan(0);
    expect(Math.max(...findFirstOrder)).toBeLessThan(Math.min(...updateOrder));
  });

  it("returns unchanged when normalized roles already match", async () => {
    mockTarget.role = "member";
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["member"],
    });

    expect(result).toEqual({ memberId: "member_2", status: "unchanged", roles: ["member"] });
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("calls updateMemberRole with headers, organizationId, memberId and normalized roles", async () => {
    mockTarget.role = "member";
    await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["admin"],
    });

    expect(mockUpdateMemberRole).toHaveBeenCalledWith({
      headers: expect.any(Headers),
      body: { memberId: "member_2", organizationId: "org_1", role: ["admin"] },
    });
  });

  it("rejects unauthenticated actors", async () => {
    mockGetSession.mockResolvedValue(null as never);
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["member"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "UNAUTHENTICATED" }),
    );
  });

  it("rejects actors who are not a member of the explicit organization", async () => {
    mockActor.organizationId = "org_other";
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["member"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "NOT_A_MEMBER" }),
    );
  });

  it("rejects actors missing the member:update permission", async () => {
    mockHasPermission.mockResolvedValue({ success: false } as never);
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["admin"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "MISSING_PERMISSION" }),
    );
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("rejects self-editing", async () => {
    mockTarget.userId = "user_actor";
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["admin"],
    });
    expect(result).toEqual(expect.objectContaining({ memberId: "member_2", status: "failed", code: "SELF" }));
  });

  it("rejects editing an owner target", async () => {
    mockTarget.role = "owner";
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["admin"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "OWNER_PROTECTED" }),
    );
  });

  it("rejects assigning the owner role directly", async () => {
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["owner"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "OWNER_PROTECTED" }),
    );
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("prevents an admin from promoting a member to admin beyond their own rank ceiling", async () => {
    mockActor.role = "admin";
    mockTarget.role = "member";
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["admin"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "SAME_OR_HIGHER_RANK" }),
    );
  });

  it("rejects an admin managing another admin", async () => {
    mockActor.role = "admin";
    mockTarget.role = "admin";
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["member"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "SAME_OR_HIGHER_RANK" }),
    );
  });

  it("rejects an empty role set", async () => {
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: [],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "EMPTY_ROLE_SET" }),
    );
  });

  it("rejects unknown requested roles", async () => {
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["superadmin"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "UNKNOWN_ROLE" }),
    );
  });

  it("fails closed when persisted target roles contain an unknown role", async () => {
    mockTarget.role = "member,legacy-role";
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["admin"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "UNKNOWN_ROLE" }),
    );
  });

  it("returns MEMBER_NOT_FOUND when the target does not exist in the explicit organization", async () => {
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_missing",
      roles: ["admin"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_missing", status: "failed", code: "MEMBER_NOT_FOUND" }),
    );
  });

  it("captures unexpected errors and returns a generic UPDATE_FAILED outcome without leaking internals", async () => {
    const boom = new Error("connection reset");
    mockUpdateMemberRole.mockRejectedValue(boom);
    const result = await replaceMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberId: "member_2",
      roles: ["admin"],
    });
    expect(result).toEqual(
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "UPDATE_FAILED" }),
    );
    expect(mockCaptureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({
        operation: "member-role-replace",
        organizationId: "org_1",
        memberId: "member_2",
      }),
    );
  });
});

describe("mutateMemberRoles", () => {
  it("preserves unrelated roles for add/remove", async () => {
    mockTarget.role = "admin,member";
    const result = await mutateMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberIds: ["member_2"],
      operation: "remove",
      roles: ["member"],
    });
    expect(mockUpdateMemberRole).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ role: ["admin"] }),
      }),
    );
    expect(result.outcomes).toEqual([
      expect.objectContaining({ memberId: "member_2", status: "updated", roles: ["admin"] }),
    ]);
  });

  it("preserves existing roles for bulk add", async () => {
    mockTarget.role = "member";
    const result = await mutateMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberIds: ["member_2"],
      operation: "add",
      roles: ["admin"],
    });
    expect(mockUpdateMemberRole).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({ role: ["admin", "member"] }),
      }),
    );
    expect(result.outcomes).toEqual([
      expect.objectContaining({ memberId: "member_2", status: "updated", roles: ["admin", "member"] }),
    ]);
  });

  it("rejects removal of the final role", async () => {
    mockTarget.role = "member";
    const result = await mutateMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberIds: ["member_2"],
      operation: "remove",
      roles: ["member"],
    });
    expect(result.outcomes).toEqual([
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "EMPTY_ROLE_SET" }),
    ]);
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("returns unchanged when add has no effect", async () => {
    mockTarget.role = "admin,member";
    const result = await mutateMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberIds: ["member_2"],
      operation: "add",
      roles: ["member"],
    });
    expect(result.outcomes).toEqual([
      expect.objectContaining({ memberId: "member_2", status: "unchanged" }),
    ]);
    expect(mockUpdateMemberRole).not.toHaveBeenCalled();
  });

  it("prevents an admin from using bulk add to promote a member to admin, without blocking other member/functional role adds", async () => {
    mockActor.role = "admin";
    installFindFirst(async ({ where }) => {
      if ("userId" in where) {
        return where.userId === mockActor.userId ? { ...mockActor } : null;
      }
      if (where.id === "member_2") return { id: "member_2", organizationId: "org_1", userId: "user_2", role: "member" };
      if (where.id === "member_3") return { id: "member_3", organizationId: "org_1", userId: "user_3", role: "member" };
      return null;
    });

    const result = await mutateMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberIds: ["member_2", "member_3"],
      operation: "add",
      roles: ["admin"],
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({ memberId: "member_2", status: "failed", code: "SAME_OR_HIGHER_RANK" }),
      expect.objectContaining({ memberId: "member_3", status: "failed", code: "SAME_OR_HIGHER_RANK" }),
    ]);
  });

  it("validates the requested role set once before starting any workers", async () => {
    await expect(
      mutateMemberRoles({
        headers: new Headers(),
        organizationId: "org_1",
        memberIds: ["member_2"],
        operation: "add",
        roles: [],
      }),
    ).rejects.toMatchObject({ code: "EMPTY_ROLE_SET" });
    expect(mockFindFirst).not.toHaveBeenCalledWith(expect.objectContaining({ where: { id: "member_2", organizationId: "org_1" } }));
  });

  it("continues processing other targets after one target fails, and never rejects the whole batch", async () => {
    installFindFirst(async ({ where }) => {
      if ("userId" in where) {
        return where.userId === mockActor.userId ? { ...mockActor } : null;
      }
      if (where.id === "member_self") return { id: "member_self", organizationId: "org_1", userId: "user_actor", role: "member" };
      if (where.id === "member_ok_1") return { id: "member_ok_1", organizationId: "org_1", userId: "user_ok_1", role: "member" };
      if (where.id === "member_ok_2") return { id: "member_ok_2", organizationId: "org_1", userId: "user_ok_2", role: "member" };
      return null;
    });

    const result = await mutateMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberIds: ["member_self", "member_ok_1", "member_ok_2"],
      operation: "add",
      roles: ["admin"],
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({ memberId: "member_self", status: "failed", code: "SELF" }),
      expect.objectContaining({ memberId: "member_ok_1", status: "updated" }),
      expect.objectContaining({ memberId: "member_ok_2", status: "updated" }),
    ]);
  });

  it("bounds concurrency to at most 4 simultaneous updates", async () => {
    const memberIds = Array.from({ length: 20 }, (_, i) => `member_${i}`);
    installFindFirst(async ({ where }) => {
      if ("userId" in where) {
        return where.userId === mockActor.userId ? { ...mockActor } : null;
      }
      if (typeof where.id === "string" && where.id.startsWith("member_")) {
        return { id: where.id, organizationId: "org_1", userId: `user_${where.id}`, role: "member" };
      }
      return null;
    });

    let active = 0;
    let maxActive = 0;
    mockUpdateMemberRole.mockImplementation((async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active -= 1;
      return { member: { id: "x", role: "admin" } };
    }) as never);

    const result = await mutateMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberIds,
      operation: "add",
      roles: ["admin"],
    });

    expect(result.outcomes).toHaveLength(20);
    expect(result.outcomes.every((outcome) => outcome.status === "updated")).toBe(true);
    expect(maxActive).toBeLessThanOrEqual(4);
    expect(maxActive).toBeGreaterThan(1);
  });

  it("captures unexpected per-target errors and returns UPDATE_FAILED without stopping the batch", async () => {
    installFindFirst(async ({ where }) => {
      if ("userId" in where) {
        return where.userId === mockActor.userId ? { ...mockActor } : null;
      }
      if (where.id === "member_bad") return { id: "member_bad", organizationId: "org_1", userId: "user_bad", role: "member" };
      if (where.id === "member_ok") return { id: "member_ok", organizationId: "org_1", userId: "user_ok", role: "member" };
      return null;
    });
    const boom = new Error("db exploded");
    mockUpdateMemberRole.mockImplementation((async (input: { body: { memberId: string } }) => {
      const memberId = input.body.memberId;
      if (memberId === "member_bad") throw boom;
      return { member: { id: memberId, role: "admin" } };
    }) as never);

    const result = await mutateMemberRoles({
      headers: new Headers(),
      organizationId: "org_1",
      memberIds: ["member_bad", "member_ok"],
      operation: "add",
      roles: ["admin"],
    });

    expect(result.outcomes).toEqual([
      expect.objectContaining({ memberId: "member_bad", status: "failed", code: "UPDATE_FAILED" }),
      expect.objectContaining({ memberId: "member_ok", status: "updated" }),
    ]);
    expect(mockCaptureException).toHaveBeenCalledWith(
      boom,
      expect.objectContaining({ operation: "member-role-bulk", organizationId: "org_1", memberId: "member_bad" }),
    );
  });
});

describe("getMemberManagementContext", () => {
  it("reports canManageMembers, actorRoles, and per-member eligibility", async () => {
    mockActor.role = "owner";
    mockTarget.role = "member";
    const context = await getMemberManagementContext(new Headers(), "org_1", ["member_2"]);

    expect(context.canManageMembers).toBe(true);
    expect(context.actorRoles).toEqual(["owner"]);
    expect(context.members["member_2"]).toEqual({
      allowed: true,
      reason: null,
      canTransferOwnership: true,
    });
  });

  it("reports a safe reason for protected members instead of throwing", async () => {
    mockActor.role = "admin";
    mockTarget.role = "admin";
    const context = await getMemberManagementContext(new Headers(), "org_1", ["member_2"]);

    expect(context.members["member_2"]).toEqual({
      allowed: false,
      reason: "SAME_OR_HIGHER_RANK",
      canTransferOwnership: false,
    });
  });

  it("omits members that no longer exist in the explicit organization", async () => {
    const context = await getMemberManagementContext(new Headers(), "org_1", ["member_missing"]);
    expect(context.members).toEqual({});
  });
});

describe("MemberRoleManagementError", () => {
  it("carries a typed failure code", () => {
    const error = new MemberRoleManagementError("SELF", "cannot edit self");
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("SELF");
    expect(error.message).toBe("cannot edit self");
  });
});
