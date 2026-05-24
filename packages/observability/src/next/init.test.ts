import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({ init: vi.fn() }));

import * as Sentry from "@sentry/nextjs";
import { createInitOptions, initClientSentry } from "./init";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
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

describe("initClientSentry()", () => {
  it("initializes with NEXT_PUBLIC_SENTRY_DSN when SENTRY_DSN is unset (browser)", () => {
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    initClientSentry("dashboard");
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({ dsn: "https://key@o1.ingest.sentry.io/1" }),
    );
  });

  it("does not initialize when no DSN is available at all", () => {
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "");
    initClientSentry("dashboard");
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("does not initialize for a disabled app even with a client DSN", () => {
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    initClientSentry("public-api");
    expect(Sentry.init).not.toHaveBeenCalled();
  });
});
