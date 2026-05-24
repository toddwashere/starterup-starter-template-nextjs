import { keys } from "../keys";

export type PostHogAppId =
  | "dashboard"
  | "www"
  | "public-api"
  | "workers"
  | "public-mcp";

export type PostHogAppConfig = {
  enabled: boolean;
  analytics: boolean;
  featureFlags: boolean;
  sessionReplay: boolean;
  autocapture: boolean;
  capturePageview: boolean;
  capturePageleave: boolean;
};

export const posthogApps: Record<PostHogAppId, PostHogAppConfig> = {
  dashboard: {
    enabled: true,
    analytics: true,
    featureFlags: false,
    sessionReplay: false,
    autocapture: true,
    capturePageview: true,
    capturePageleave: true,
  },
  www: {
    enabled: true,
    analytics: true,
    featureFlags: false,
    sessionReplay: false,
    autocapture: true,
    capturePageview: true,
    capturePageleave: true,
  },
  "public-api": {
    enabled: false,
    analytics: true,
    featureFlags: false,
    sessionReplay: false,
    autocapture: false,
    capturePageview: false,
    capturePageleave: false,
  },
  workers: {
    enabled: false,
    analytics: true,
    featureFlags: false,
    sessionReplay: false,
    autocapture: false,
    capturePageview: false,
    capturePageleave: false,
  },
  "public-mcp": {
    enabled: false,
    analytics: true,
    featureFlags: false,
    sessionReplay: false,
    autocapture: false,
    capturePageview: false,
    capturePageleave: false,
  },
};

export function resolvePostHogConfig(appId: PostHogAppId): {
  active: boolean;
  app: PostHogAppConfig;
  token: string;
  host: string;
} | null {
  const { NEXT_PUBLIC_POSTHOG_TOKEN, posthogHost } = keys();
  if (!NEXT_PUBLIC_POSTHOG_TOKEN) return null;

  const app = posthogApps[appId];
  if (!app.enabled) return null;

  return {
    active: true,
    app,
    token: NEXT_PUBLIC_POSTHOG_TOKEN,
    host: posthogHost,
  };
}
