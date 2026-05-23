import { enqueue } from "@workspace/worker-queue";

/**
 * Enqueue a background `user.welcome-email` job for a newly-created user.
 *
 * This is the producer side of the worker-queue pattern: instead of sending
 * the welcome email inline during signup, we publish a job that apps/workers
 * consumes. Failures here are logged but never thrown — a queue hiccup must
 * not break user signup. (At-least-once delivery; the handler should be safe
 * to run more than once.)
 *
 * NOTE (product choice): the existing sendVerificationEmail flow already sends
 * a "welcome + verify" email on signup. This enqueued plain welcome email is
 * ADDED to demonstrate the async producer pattern; a real app would pick one
 * to avoid double-messaging. With no RESEND_API_KEY set, the worker's handler
 * just logs (sendWelcomeEmail no-ops), so locally this is side-effect free.
 */
export async function enqueueWelcomeEmail(userId: string): Promise<void> {
  try {
    await enqueue("user.welcome-email", { userId });
  } catch (error) {
    console.error(
      `[auth] failed to enqueue welcome email for user ${userId}`,
      error,
    );
  }
}
