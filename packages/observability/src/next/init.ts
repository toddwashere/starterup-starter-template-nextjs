import * as Sentry from "@sentry/nextjs";
import type { ErrorEvent, EventHint } from "@sentry/nextjs";
import { clientDsn } from "../../keys";
import { resolveSentryConfig, sentryApps, type SentryAppId } from "../sentry-config";

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

// App-config gate only (does NOT consult the DSN — the caller supplies the
// runtime-appropriate DSN, which may be the client NEXT_PUBLIC value).
function appCapturesErrors(appId: SentryAppId): boolean {
  const app = sentryApps[appId];
  return app.enabled && app.errors;
}

// `dsn` is the runtime-appropriate DSN for the calling environment:
// the client passes clientDsn() (NEXT_PUBLIC_SENTRY_DSN, injected at build time),
// while server/edge pass the server-side SENTRY_DSN.
function safeInit(appId: SentryAppId, dsn: string | undefined): void {
  if (!dsn) return;
  if (!appCapturesErrors(appId)) return;
  try {
    Sentry.init(buildBaseOptions(appId, dsn));
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
