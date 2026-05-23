import type { HandlerRegistry } from "../registry";

import { handleAiExample } from "./ai-example";
import { handleCleanupExpiredSessions } from "./cleanup-expired-sessions";
import { handleUserWelcomeEmail } from "./user-welcome-email";
import { handleWebhookDeliver } from "./webhook-deliver";

/**
 * The concrete handler registry. The `HandlerRegistry` mapped type gives a
 * compile error if any event is missing a handler, guaranteeing coverage.
 *
 * Kept separate from `registry.ts` so the mechanism (types + getHandler) has
 * no `@workspace/database`/`@workspace/email` imports and stays testable
 * without DATABASE_URL.
 */
export const handlers: HandlerRegistry = {
  "user.welcome-email": handleUserWelcomeEmail,
  "cleanup.expired-sessions": handleCleanupExpiredSessions,
  "webhook.deliver": handleWebhookDeliver,
  "ai.example": handleAiExample,
};
