import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/node", () => ({
  init: vi.fn(),
}));

import * as Sentry from "@sentry/node";
import { initNodeObservability } from "./init";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("initNodeObservability()", () => {
  it("does not init when app is disabled", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    initNodeObservability("public-api");
    expect(Sentry.init).not.toHaveBeenCalled();
  });

  it("inits when app is enabled and DSN set", () => {
    vi.stubEnv("SENTRY_DSN", "https://key@o1.ingest.sentry.io/1");
    initNodeObservability("dashboard");
    expect(Sentry.init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: "https://key@o1.ingest.sentry.io/1",
      }),
    );
  });
});
