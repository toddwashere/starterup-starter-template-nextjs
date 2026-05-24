import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: {
    init: vi.fn(),
    register: vi.fn(),
  },
}));

import posthog from "posthog-js";
import {
  createClientInitOptions,
  initClientPostHog,
  isPostHogClientActive,
} from "./init";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("createClientInitOptions()", () => {
  it("returns analytics-only options for dashboard", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    const result = createClientInitOptions("dashboard");

    expect(result).toEqual(
      expect.objectContaining({
        token: "phc_test",
        options: expect.objectContaining({
          api_host: "https://us.i.posthog.com",
          advanced_disable_feature_flags: true,
          disable_session_recording: true,
          person_profiles: "identified_only",
          autocapture: true,
          capture_pageview: true,
        }),
      }),
    );
  });

  it("returns null when token is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");

    expect(createClientInitOptions("dashboard")).toBeNull();
  });

  it("returns null when app is disabled", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    expect(createClientInitOptions("public-api")).toBeNull();
  });
});

describe("initClientPostHog()", () => {
  it("no-ops when token is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");

    initClientPostHog("dashboard");

    expect(posthog.init).not.toHaveBeenCalled();
    expect(isPostHogClientActive()).toBe(false);
  });

  it("calls posthog.init when configured", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    initClientPostHog("dashboard");

    expect(posthog.init).toHaveBeenCalledOnce();
    expect(isPostHogClientActive()).toBe(true);
  });
});
