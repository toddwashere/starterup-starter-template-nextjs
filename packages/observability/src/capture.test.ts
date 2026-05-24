import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  setUser: vi.fn(),
  addBreadcrumb: vi.fn(),
}));

import * as Sentry from "@sentry/nextjs";
import { addBreadcrumb, captureException, setUser } from "./capture";

const DSN = "https://key@o1.ingest.sentry.io/1";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("capture API without SENTRY_DSN", () => {
  it("captureException does not call Sentry", () => {
    vi.stubEnv("SENTRY_DSN", "");
    captureException(new Error("test"));
    expect(Sentry.captureException).not.toHaveBeenCalled();
  });

  it("setUser does not call Sentry", () => {
    vi.stubEnv("SENTRY_DSN", "");
    setUser({ id: "u1", email: "a@b.com" });
    expect(Sentry.setUser).not.toHaveBeenCalled();
  });

  it("addBreadcrumb does not call Sentry", () => {
    vi.stubEnv("SENTRY_DSN", "");
    addBreadcrumb({ message: "hello" });
    expect(Sentry.addBreadcrumb).not.toHaveBeenCalled();
  });
});

describe("capture API with NEXT_PUBLIC_SENTRY_DSN only (client/browser case)", () => {
  it("activates via NEXT_PUBLIC_SENTRY_DSN when SENTRY_DSN is unset (client/browser case)", () => {
    vi.stubEnv("SENTRY_DSN", "");
    vi.stubEnv("NEXT_PUBLIC_SENTRY_DSN", DSN);
    const error = new Error("boom");
    captureException(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, undefined);
  });
});

describe("capture API with SENTRY_DSN set", () => {
  it("captureException forwards error and maps context to extra", () => {
    vi.stubEnv("SENTRY_DSN", DSN);
    const error = new Error("boom");
    captureException(error, { userId: "u1" });
    expect(Sentry.captureException).toHaveBeenCalledWith(error, {
      extra: { userId: "u1" },
    });
  });

  it("captureException omits options when no context is given", () => {
    vi.stubEnv("SENTRY_DSN", DSN);
    const error = new Error("boom");
    captureException(error);
    expect(Sentry.captureException).toHaveBeenCalledWith(error, undefined);
  });

  it("setUser forwards the user", () => {
    vi.stubEnv("SENTRY_DSN", DSN);
    setUser({ id: "u1", email: "a@b.com" });
    expect(Sentry.setUser).toHaveBeenCalledWith({ id: "u1", email: "a@b.com" });
  });

  it("addBreadcrumb forwards the breadcrumb", () => {
    vi.stubEnv("SENTRY_DSN", DSN);
    addBreadcrumb({ message: "hello", category: "ui" });
    expect(Sentry.addBreadcrumb).toHaveBeenCalledWith({
      message: "hello",
      category: "ui",
    });
  });
});
