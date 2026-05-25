import { afterEach, describe, expect, it, vi } from "vitest";

describe("public API env", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("parses and normalizes NEXT_PUBLIC_API_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "http://localhost:4002/");
    const { getPublicApiUrl, getPublicApiListenPort } = await import(
      "./public-api.js"
    );
    expect(getPublicApiUrl()).toBe("http://localhost:4002");
    expect(getPublicApiListenPort()).toBe(4002);
  });

  it("throws when NEXT_PUBLIC_API_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_API_URL;
    const { getPublicApiUrl } = await import("./public-api.js");
    expect(() => getPublicApiUrl()).toThrow(/NEXT_PUBLIC_API_URL is required/);
  });
});
