import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@workspace/database";

import { handleCleanupExpiredSessions } from "./cleanup-expired-sessions";

vi.mock("@workspace/database", () => ({
  prisma: { session: { deleteMany: vi.fn() } },
}));

const deleteMany = vi.mocked(prisma.session.deleteMany);

describe("handleCleanupExpiredSessions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes sessions whose expiresAt is before now", async () => {
    deleteMany.mockResolvedValue({ count: 3 } as never);
    const before = Date.now();

    await handleCleanupExpiredSessions({});

    expect(deleteMany).toHaveBeenCalledTimes(1);
    const arg = deleteMany.mock.calls[0]![0]!;
    const expiresAt = arg.where!.expiresAt as { lt: Date };
    const lt = expiresAt.lt;
    expect(lt).toBeInstanceOf(Date);
    const ltMs = lt.getTime();
    expect(ltMs).toBeGreaterThanOrEqual(before);
    expect(ltMs).toBeLessThanOrEqual(Date.now());
  });

  it("resolves when deleteMany resolves with a count", async () => {
    deleteMany.mockResolvedValue({ count: 0 } as never);

    await expect(
      handleCleanupExpiredSessions({}),
    ).resolves.toBeUndefined();
  });
});
