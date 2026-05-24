import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    aiThread: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

import { prisma } from "@workspace/database";
import {
  getAiThreadById,
  getOrCreateActiveAiThread,
  listAiThreadsForOrg,
} from "./ai-thread-repo";

beforeEach(() => vi.clearAllMocks());

const makeThread = (overrides = {}) => ({
  id: "aith_abc",
  organizationId: "org_1",
  userId: "user_1",
  title: null,
  createdAt: new Date(),
  updatedAt: new Date(),
  ...overrides,
});

describe("getOrCreateActiveAiThread", () => {
  it("returns the existing most-recently-updated thread when one exists", async () => {
    const existingThread = makeThread({ id: "aith_existing" });
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(existingThread as never);

    const result = await getOrCreateActiveAiThread("user_1", "org_1");

    expect(prisma.aiThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", userId: "user_1" },
        orderBy: { updatedAt: "desc" },
      }),
    );
    expect(prisma.aiThread.create).not.toHaveBeenCalled();
    expect(result).toEqual(existingThread);
  });

  it("creates a new thread with aith_ prefixed id when none exists", async () => {
    const newThread = makeThread({ id: "aith_new" });
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.aiThread.create).mockResolvedValue(newThread as never);

    const result = await getOrCreateActiveAiThread("user_1", "org_1");

    expect(prisma.aiThread.create).toHaveBeenCalledOnce();
    const createCall = vi.mocked(prisma.aiThread.create).mock.calls[0]?.[0];
    expect(createCall?.data.id).toMatch(/^aith_/);
    expect(createCall?.data.userId).toBe("user_1");
    expect(createCall?.data.organizationId).toBe("org_1");
    expect(result).toEqual(newThread);
  });
});

describe("getAiThreadById", () => {
  it("returns the thread when it belongs to the given org and user", async () => {
    const thread = makeThread();
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(thread as never);

    const result = await getAiThreadById("aith_abc", "org_1", "user_1");

    expect(prisma.aiThread.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "aith_abc", organizationId: "org_1", userId: "user_1" },
      }),
    );
    expect(result).toEqual(thread);
  });

  it("returns null when org/user does not match (ownership enforced)", async () => {
    vi.mocked(prisma.aiThread.findFirst).mockResolvedValue(null);

    const result = await getAiThreadById("aith_abc", "org_other", "user_other");

    expect(result).toBeNull();
  });
});

describe("listAiThreadsForOrg", () => {
  it("returns threads scoped to organizationId and userId ordered by updatedAt desc", async () => {
    vi.mocked(prisma.aiThread.findMany).mockResolvedValue([]);

    await listAiThreadsForOrg("org_1", "user_1");

    expect(prisma.aiThread.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { organizationId: "org_1", userId: "user_1" },
        orderBy: { updatedAt: "desc" },
      }),
    );
  });
});
