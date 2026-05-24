import { afterEach, describe, expect, it, vi } from "vitest";
import { createInitOptions } from "./init";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("createInitOptions()", () => {
  it("returns null when DSN is missing", () => {
    vi.stubEnv("SENTRY_DSN", "");
    expect(createInitOptions("dashboard")).toBeNull();
  });

  it("returns errors-only options with app tag", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");

    const options = createInitOptions("dashboard");

    expect(options).not.toBeNull();
    expect(options!.dsn).toBe("https://key@o1.ingest.sentry.io/1");

    // initialScope is CaptureContext (union type); narrow to the Partial<ScopeContext> form
    const scope = options!.initialScope as { tags?: Record<string, string> };
    expect(scope.tags?.app).toBe("dashboard");

    // integrations in CoreOptions is Integration[] | ((integrations: Integration[]) => Integration[])
    expect(options!.integrations).toEqual([]);

    // enableLogs and replaysSessionSampleRate are both optional on the options union
    const opts = options as Record<string, unknown>;
    expect(opts["tracesSampleRate"]).toBeUndefined();
    expect(opts["replaysSessionSampleRate"]).toBeUndefined();
    expect(opts["enableLogs"]).toBeUndefined();
  });

  it("returns null for disabled app", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    expect(createInitOptions("public-api")).toBeNull();
  });
});
