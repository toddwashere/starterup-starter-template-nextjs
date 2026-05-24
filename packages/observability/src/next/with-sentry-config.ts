import { withSentryConfig as sentryWithSentryConfig } from "@sentry/nextjs";
import type { NextConfig } from "next";
import type { SentryAppId } from "../sentry-config";

export function withSentryConfig(
  nextConfig: NextConfig,
  // Reserved: identifies the calling app for future per-app DSN/project
  // selection. Unused today (single shared SENTRY_DSN), kept for a stable API.
  _appId: SentryAppId,
): NextConfig {
  const configWithEnv: NextConfig = {
    ...nextConfig,
    env: {
      ...nextConfig.env,
      // Single user-facing env var; exposed to client bundle at build time
      NEXT_PUBLIC_SENTRY_DSN: process.env.SENTRY_DSN ?? "",
    },
  };

  return sentryWithSentryConfig(configWithEnv, {
    silent: !process.env.CI,
  });
}
