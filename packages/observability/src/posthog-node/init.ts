import { PostHog } from "posthog-node";
import { resolvePostHogConfig, type PostHogAppId } from "../posthog-config";

let nodeClient: PostHog | null = null;

export function getNodePostHog(): PostHog | null {
  return nodeClient;
}

export function initNodePostHog(appId: PostHogAppId): PostHog | null {
  const resolved = resolvePostHogConfig(appId);
  if (!resolved || !resolved.app.analytics) return null;

  try {
    nodeClient = new PostHog(resolved.token, {
      host: resolved.host,
      flushAt: 1,
      flushInterval: 0,
    });
    return nodeClient;
  } catch (err) {
    console.error("[observability] PostHog node init failed:", err);
    return null;
  }
}
