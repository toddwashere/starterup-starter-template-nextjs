import { prisma } from "@workspace/database";
import { sendWelcomeEmail } from "@workspace/email/send-welcome-email";

import { keys } from "../../keys";
import type { JobHandler } from "../registry";

/**
 * Send the welcome email for a newly created user.
 *
 * Idempotency note: a `processed_jobs` dedupe table is out of scope for v1.
 * With at-least-once delivery, a welcome email could rarely be sent twice
 * (e.g. if the process dies after sending but before acking). That is
 * acceptable for v1; dedupe is optional future work.
 */
export const handleUserWelcomeEmail: JobHandler<"user.welcome-email"> = async (
  payload,
) => {
  const user = await prisma.user.findUnique({ where: { id: payload.userId } });
  if (!user) {
    // User no longer exists (deleted, or a stale job). Retrying won't help.
    console.warn(
      `[workers] user.welcome-email: user ${payload.userId} not found; skipping`,
    );
    return;
  }

  const getStartedUrl = keys().DASHBOARD_URL;
  await sendWelcomeEmail({
    recipient: user.email,
    name: user.name,
    getStartedUrl,
  });
};
