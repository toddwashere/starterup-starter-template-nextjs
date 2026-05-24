import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveSentryConfig } from "./sentry-config";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolveSentryConfig()", () => {
  it("returns active config for dashboard when DSN is set", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");

    const result = resolveSentryConfig("dashboard");

    expect(result).not.toBeNull();
    expect(result!.active).toBe(true);
    expect(result!.app.errors).toBe(true);
  });

  it("returns null when SENTRY_DSN is missing", () => {
    vi.stubEnv("SENTRY_DSN", "");

    expect(resolveSentryConfig("dashboard")).toBeNull();
  });

  it("returns null when app is disabled in config", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");

    expect(resolveSentryConfig("public-api")).toBeNull();
  });
});
