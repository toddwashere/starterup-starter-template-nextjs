import * as Sentry from "@sentry/node";
import { resolveSentryConfig, type SentryAppId } from "../sentry-config";

export function initNodeObservability(appId: SentryAppId): void {
  const resolved = resolveSentryConfig(appId);
  if (!resolved || !resolved.app.errors) return;

  try {
    Sentry.init({
      dsn: resolved.dsn,
      environment: process.env.NODE_ENV,
      release: process.env.VERCEL_GIT_COMMIT_SHA,
      initialScope: {
        tags: { app: appId },
      },
      // Errors only in v1 — tracing stays off because tracesSampleRate is
      // omitted; no extra integrations registered. Mirrors src/next/init.ts.
      integrations: [],
    });
  } catch (err) {
    console.error("[observability] Sentry node init failed:", err);
  }
}
