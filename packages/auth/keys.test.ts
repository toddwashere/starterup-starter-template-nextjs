import { describe, it, expect, afterEach } from "vitest";
import { keys } from "./keys";

describe("auth keys", () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("defaults BETTER_AUTH_SECRET for local dev", () => {
    delete process.env.BETTER_AUTH_SECRET;
    expect(keys().BETTER_AUTH_SECRET).toBe(
      "better-auth-secret-12345678901234567890",
    );
  });

  it("defaults BETTER_AUTH_URL for local dev", () => {
    delete process.env.BETTER_AUTH_URL;
    expect(keys().BETTER_AUTH_URL).toBe("http://localhost:4000");
  });

  it("allows OAuth vars to be unset", () => {
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.MICROSOFT_CLIENT_ID;
    expect(keys().GOOGLE_CLIENT_ID).toBeUndefined();
  });

  it("rejects malformed BETTER_AUTH_URL", () => {
    process.env.BETTER_AUTH_URL = "not-a-url";
    expect(() => keys()).toThrow();
  });

  it("defaults MICROSOFT_TENANT_ID to common", () => {
    delete process.env.MICROSOFT_TENANT_ID;
    expect(keys().MICROSOFT_TENANT_ID).toBe("common");
  });

  it("rejects GOOGLE_CLIENT_ID set without GOOGLE_CLIENT_SECRET", () => {
    process.env.GOOGLE_CLIENT_ID = "gid";
    delete process.env.GOOGLE_CLIENT_SECRET;
    expect(() => keys()).toThrow();
  });

  it("rejects MICROSOFT_CLIENT_ID set without MICROSOFT_CLIENT_SECRET", () => {
    process.env.MICROSOFT_CLIENT_ID = "mid";
    delete process.env.MICROSOFT_CLIENT_SECRET;
    expect(() => keys()).toThrow();
  });

  it("accepts both Google credential vars when both are set", () => {
    process.env.GOOGLE_CLIENT_ID = "gid";
    process.env.GOOGLE_CLIENT_SECRET = "gsecret";
    expect(() => keys()).not.toThrow();
  });
});
