import posthog from "posthog-js";
import {
  resolvePostHogConfig,
  type PostHogAppId,
} from "../posthog-config";

export type PostHogClientInit = {
  token: string;
  options: Parameters<typeof posthog.init>[1];
};

let clientActive = false;

export function isPostHogClientActive(): boolean {
  return clientActive;
}

function buildInitOptions(
  appId: PostHogAppId,
  host: string,
  app: NonNullable<ReturnType<typeof resolvePostHogConfig>>["app"],
): NonNullable<Parameters<typeof posthog.init>[1]> {
  return {
    api_host: host,
    // Match PostHog wizard/docs — update if wizard used a different defaults pin
    defaults: "2026-01-30",
    autocapture: app.autocapture,
    capture_pageview: app.capturePageview,
    capture_pageleave: app.capturePageleave,
    person_profiles: "identified_only",
    advanced_disable_feature_flags: !app.featureFlags,
    disable_session_recording: !app.sessionReplay,
    loaded: (ph) => {
      ph.register({ app: appId });
    },
  };
}

export function createClientInitOptions(
  appId: PostHogAppId,
): PostHogClientInit | null {
  const resolved = resolvePostHogConfig(appId);
  if (!resolved || !resolved.app.analytics) return null;

  return {
    token: resolved.token,
    options: buildInitOptions(appId, resolved.host, resolved.app),
  };
}

export function initClientPostHog(appId: PostHogAppId): void {
  const config = createClientInitOptions(appId);
  if (!config) return;

  try {
    posthog.init(config.token, config.options);
    clientActive = true;
  } catch (err) {
    console.error("[observability] PostHog init failed:", err);
  }
}
