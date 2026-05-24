import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("posthog-js", () => ({
  default: {
    capture: vi.fn(),
    identify: vi.fn(),
    reset: vi.fn(),
  },
}));

vi.mock("./init", () => ({
  isPostHogClientActive: vi.fn(() => false),
}));

import posthog from "posthog-js";
import { isPostHogClientActive } from "./init";
import { capture, identify, reset } from "./analytics";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  vi.mocked(isPostHogClientActive).mockReturnValue(false);
});

describe("analytics API when inactive", () => {
  it("capture does not call posthog", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");
    capture("test_event");
    expect(posthog.capture).not.toHaveBeenCalled();
  });

  it("identify does not call posthog", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");
    identify("u1", { email: "a@b.com" });
    expect(posthog.identify).not.toHaveBeenCalled();
  });

  it("reset does not call posthog", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "");
    reset();
    expect(posthog.reset).not.toHaveBeenCalled();
  });
});

describe("analytics API when active", () => {
  it("capture forwards event and properties", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");
    vi.mocked(isPostHogClientActive).mockReturnValue(true);

    capture("button_clicked", { plan: "pro" });

    expect(posthog.capture).toHaveBeenCalledWith("button_clicked", {
      plan: "pro",
    });
  });

  it("identify forwards user id and properties", () => {
    vi.stubEnv("NEXT_PUBLIC_POSTHOG_TOKEN", "phc_test");
    vi.mocked(isPostHogClientActive).mockReturnValue(true);

    identify("u1", { email: "a@b.com" });

    expect(posthog.identify).toHaveBeenCalledWith("u1", { email: "a@b.com" });
  });
});
