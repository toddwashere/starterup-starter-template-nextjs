import posthog from "posthog-js";
import { keys } from "../../keys";
import { isPostHogClientActive } from "./init";

function canCapture(): boolean {
  return Boolean(keys().NEXT_PUBLIC_POSTHOG_TOKEN) && isPostHogClientActive();
}

export function capture(
  event: string,
  properties?: Record<string, unknown>,
): void {
  if (!canCapture()) return;
  try {
    posthog.capture(event, properties);
  } catch {
    // Never throw from observability helpers
  }
}

export function identify(
  userId: string,
  properties?: { email?: string },
): void {
  if (!canCapture()) return;
  try {
    posthog.identify(userId, properties);
  } catch {
    // no-op
  }
}

export function reset(): void {
  if (!canCapture()) return;
  try {
    posthog.reset();
  } catch {
    // no-op
  }
}
