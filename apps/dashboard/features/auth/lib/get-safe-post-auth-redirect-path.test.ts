import { describe, expect, it } from "vitest";
import {
  getSafePostAuthRedirectPath,
  withRedirectToQuery,
} from "./get-safe-post-auth-redirect-path";

describe("getSafePostAuthRedirectPath", () => {
  it("returns relative dashboard paths", () => {
    expect(
      getSafePostAuthRedirectPath("/accept-invitation/authinv_abc"),
    ).toBe("/accept-invitation/authinv_abc");
    expect(getSafePostAuthRedirectPath("/create-org")).toBe("/create-org");
  });

  it("falls back for missing or absolute URLs", () => {
    expect(getSafePostAuthRedirectPath(null)).toBe("/");
    expect(getSafePostAuthRedirectPath(undefined)).toBe("/");
    expect(getSafePostAuthRedirectPath("")).toBe("/");
    expect(getSafePostAuthRedirectPath("https://evil.example/phish")).toBe("/");
    expect(getSafePostAuthRedirectPath("//evil.example")).toBe("/");
    expect(getSafePostAuthRedirectPath("/\\evil.example")).toBe("/");
  });

  it("honors a custom fallback", () => {
    expect(getSafePostAuthRedirectPath(null, "/home")).toBe("/home");
  });
});

describe("withRedirectToQuery", () => {
  it("appends encoded redirectTo for safe paths", () => {
    expect(
      withRedirectToQuery("/sign-up", "/accept-invitation/authinv_1"),
    ).toBe("/sign-up?redirectTo=%2Faccept-invitation%2Fauthinv_1");
  });

  it("skips unsafe or empty redirect targets", () => {
    expect(withRedirectToQuery("/sign-up", "https://evil.example")).toBe(
      "/sign-up",
    );
    expect(withRedirectToQuery("/sign-up", null)).toBe("/sign-up");
  });
});
