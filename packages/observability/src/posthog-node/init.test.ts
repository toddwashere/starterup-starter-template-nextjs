import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-node", () => ({
  PostHog: vi.fn(),
}));

import { PostHog } from "posthog-node";
import { initNodePostHog } from "./init";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("initNodePostHog()", () => {
  it("does not construct PostHog when app is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    initNodePostHog("public-api");

    expect(PostHog).not.toHaveBeenCalled();
  });

  it("constructs PostHog when app is enabled and token is set", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    initNodePostHog("dashboard");

    expect(PostHog).toHaveBeenCalledWith("phc_test", {
      host: "https://us.i.posthog.com",
      flushAt: 1,
      flushInterval: 0,
    });
  });
});
