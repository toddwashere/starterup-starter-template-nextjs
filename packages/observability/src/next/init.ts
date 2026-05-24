import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { clientDsn } from "../../keys";
import { resolveSentryConfig, type SentryAppId } from "../sentry-config";

// Use the parameter type of Sentry.init to cover the browser/node/edge union
type InitOptions = NonNullable<Parameters<typeof Sentry.init>[0]>;

function buildBaseOptions(appId: SentryAppId, dsn: string): InitOptions {
  return {
    dsn,
    environment: process.env.NODE_ENV,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    initialScope: {
      tags: { app: appId },
    },
    // v1: errors only — tracing/replay/logs integrations added when config flags flip true
    integrations: [],
    beforeSend(event: ErrorEvent, hint: EventHint): ErrorEvent | null {
      const error = hint.originalException;
      if (error instanceof Error) {
        // Drop known client noise so it doesn't bury real errors:
        // aborted fetches, React hydration mismatch, and router/navigation
        // cancellations. Kept deliberately narrow to errors thrown by the
        // framework/browser, not application-thrown errors.
        if (error.name === "AbortError") return null;
        if (error.message.includes("Hydration failed")) return null;
        if (error.message.includes("cancelled")) return null;
      }
      return event;
    },
  };
}

export function createInitOptions(appId: SentryAppId): InitOptions | null {
  const resolved = resolveSentryConfig(appId);
  if (!resolved || !resolved.app.errors) return null;
  return buildBaseOptions(appId, resolved.dsn);
}

// `dsn` is the runtime-appropriate DSN for the calling environment:
// the client passes clientDsn() (NEXT_PUBLIC_SENTRY_DSN, injected at build time),
// while server/edge pass the server-side SENTRY_DSN. It intentionally overrides
// options.dsn (which holds the server SENTRY_DSN) so the client uses the public DSN.
function safeInit(appId: SentryAppId, dsn: string | undefined): void {
  if (!dsn) return;
  const options = createInitOptions(appId);
  if (!options) return;
  try {
    Sentry.init({ ...options, dsn });
  } catch (err) {
    console.error("[observability] Sentry init failed:", err);
  }
}

export function initClientSentry(appId: SentryAppId): void {
  safeInit(appId, clientDsn());
}

export function initServerSentry(appId: SentryAppId): void {
  safeInit(appId, resolveSentryConfig(appId)?.dsn);
}

export function initEdgeSentry(appId: SentryAppId): void {
  safeInit(appId, resolveSentryConfig(appId)?.dsn);
}
