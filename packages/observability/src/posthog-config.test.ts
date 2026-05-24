import { afterEach, describe, expect, it, vi } from "vitest";
import { resolvePostHogConfig } from "./posthog-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolvePostHogConfig()", () => {
  it("returns active config for dashboard when token is set", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test_token");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "");

    const result = resolvePostHogConfig("dashboard");

    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.app.analytics).toBe(true);
    expect(result!.token).toBe("phc_test_token");
    expect(result!.host).toBe("https://us.i.posthog.com");
  });

  it("uses NEXT_PUBLIC_POSTHOG_HOST when set", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_HOST", "https://eu.i.posthog.com");

    const result = resolvePostHogConfig("dashboard");

    expect(result!.host).toBe("https://eu.i.posthog.com");
  });

  it("returns null when token is missing", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");

    expect(resolvePostHogConfig("dashboard")).toBeNull();
  });

  it("returns null when app is disabled in config", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");

    expect(resolvePostHogConfig("public-api")).toBeNull();
  });
});
