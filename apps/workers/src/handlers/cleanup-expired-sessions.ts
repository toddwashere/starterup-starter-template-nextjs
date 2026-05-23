import { prisma } from "@workspace/database";

import type { JobHandler } from "../registry";

/**
 * Delete sessions whose expiry is in the past.
 *
 * A single `deleteMany` of expired rows is sufficient for v1. Very large
 * backlogs could be deleted in bounded batches in the future; we keep it
 * simple here.
 */
export const handleCleanupExpiredSessions: JobHandler<
  "cleanup.expired-sessions"
> = async () => {
  const { count } = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  console.log(
    `[workers] cleanup.expired-sessions: deleted ${count} expired session(s)`,
  );
};
