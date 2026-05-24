// Use the isomorphic Sentry SDK so this module is safe to import from both
// server code and Next.js client components (@sentry/node is not browser-safe).
import * as Sentry from "@sentry/nextjs";
import { keys } from "../keys";

function isActive(): boolean {
  return Boolean(keys().SENTRY_DSN);
}

export function captureException(
  error: unknown,
  context?: Record<string, unknown>,
): void {
  if (!isActive()) return;
  try {
    Sentry.captureException(error, context ? { extra: context } : undefined);
  } catch {
    // Never throw from observability helpers
  }
}

export function setUser(user: { id: string; email?: string } | null): void {
  if (!isActive()) return;
  try {
    Sentry.setUser(user);
  } catch {
    // no-op
  }
}

export function addBreadcrumb(breadcrumb: {
  message: string;
  category?: string;
  data?: Record<string, unknown>;
}): void {
  if (!isActive()) return;
  try {
    Sentry.addBreadcrumb(breadcrumb);
  } catch {
    // no-op
  }
}
