import { afterEach, describe, expect, it, vi } from "vitest";
import {
  assertProductionAuthUrl,
  fallbackAuthUrl,
  isLoopbackUrl,
  resolveAuthClientBaseURL,
} from "./auth-base-url";

describe("isLoopbackUrl", () => {
  it("detects localhost, 127.0.0.1, and IPv6 loopback", () => {
    expect(isLoopbackUrl("http://localhost:4000")).toBe(true);
    expect(isLoopbackUrl("http://127.0.0.1:4000")).toBe(true);
    expect(isLoopbackUrl("http://[::1]:4000")).toBe(true);
    expect(isLoopbackUrl("https://app.example.com")).toBe(false);
  });
});

describe("resolveAuthClientBaseURL", () => {
  it("uses the page origin so the dashboard never calls a baked-in localhost URL", () => {
    expect(
      resolveAuthClientBaseURL({
        configured: "http://localhost:4000",
        currentOrigin: "https://app.example.com",
      }),
    ).toBe("https://app.example.com");
  });

  it("uses the page origin even when a different public URL was configured", () => {
    expect(
      resolveAuthClientBaseURL({
        configured: "https://dashboard.example.com",
        currentOrigin: "https://app.example.com",
      }),
    ).toBe("https://app.example.com");
  });

  it("falls back to the configured URL when there is no page origin (SSR / Node)", () => {
    expect(
      resolveAuthClientBaseURL({
        configured: "https://app.example.com",
      }),
    ).toBe("https://app.example.com");
  });
});

describe("fallbackAuthUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("prefers NEXT_PUBLIC_DASHBOARD_URL over Vercel hints and localhost", () => {
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_URL", "https://app.example.com");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "ignored.vercel.app");
    expect(fallbackAuthUrl()).toBe("https://app.example.com");
  });

  it("uses the Vercel production domain when dashboard URL is unset", () => {
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "app.example.com");
    expect(fallbackAuthUrl()).toBe("https://app.example.com");
  });

  it("uses VERCEL_URL for preview deploys", () => {
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "app-git-main-team.vercel.app");
    expect(fallbackAuthUrl()).toBe("https://app-git-main-team.vercel.app");
  });

  it("falls back to local dashboard for dev", () => {
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_URL", "");
    vi.stubEnv("VERCEL_PROJECT_PRODUCTION_URL", "");
    vi.stubEnv("VERCEL_URL", "");
    expect(fallbackAuthUrl()).toBe("http://localhost:4000");
  });
});

describe("assertProductionAuthUrl", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("rejects an explicit loopback dashboard URL on Vercel production", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_URL", "http://localhost:4000");
    expect(() => assertProductionAuthUrl()).toThrow(/loopback/i);
  });

  it("allows local and preview builds to use localhost", () => {
    vi.stubEnv("VERCEL_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_DASHBOARD_URL", "http://localhost:4000");
    expect(() => assertProductionAuthUrl()).not.toThrow();
  });
});
