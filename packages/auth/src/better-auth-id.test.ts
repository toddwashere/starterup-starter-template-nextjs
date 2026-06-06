import { describe, expect, it } from "vitest";
import { createBetterAuthId } from "./better-auth-id";

describe("createBetterAuthId", () => {
  it.each([
    ["user", "user"],
    ["session", "sess"],
    ["account", "acct"],
    ["verification", "ver"],
    ["organization", "org"],
    ["member", "mbr"],
    ["invitation", "authinv"],
    ["jwks", "jwks"],
    ["apikey", "apikey"],
    ["apiKey", "apikey"],
    ["oauthClient", "oauthclient"],
    ["oauthAccessToken", "oauthat"],
    ["oauthRefreshToken", "oauthrt"],
    ["oauthConsent", "oauthc"],
  ])("maps Better Auth model %s to prefix %s", (model, prefix) => {
    expect(createBetterAuthId({ model })).toMatch(
      new RegExp(`^${prefix}_[a-z0-9]{16}$`),
    );
  });

  it("falls back to an unprefixed ID for unknown models", () => {
    const id = createBetterAuthId({ model: "unknownPluginModel" });
    expect(id).toEqual(expect.any(String));
    expect(id.length).toBeGreaterThan(10);
    expect(id).not.toContain("_");
  });
});
