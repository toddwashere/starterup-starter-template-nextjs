import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../lib/context";

vi.mock("@workspace/auth/api-keys", () => ({
  verifyApiKey: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {
    constructor(
      public code: "UNAUTHORIZED" | "RATE_LIMITED",
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@workspace/auth/oauth/verify-access-token", () => ({
  verifyOAuthAccessToken: vi.fn(),
}));

import { verifyApiKey } from "@workspace/auth/api-keys";
import { verifyOAuthAccessToken } from "@workspace/auth/oauth/verify-access-token";
import { resolveAuth } from "./resolve-auth";

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("*", resolveAuth);
  app.get("/probe", (c) => c.json({ kind: c.get("authContext").kind }));
  return app;
}

describe("resolveAuth", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets api-key context from x-api-key", async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({
      keyId: "k1",
      orgId: "org_1",
      userId: null,
      ownerType: "organization",
      permissions: {},
    });
    const res = await buildApp().request("/probe", {
      headers: { "x-api-key": "sk_org_x" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { kind: string }).kind).toBe("api-key");
  });

  it("sets oauth context from Bearer", async () => {
    vi.mocked(verifyOAuthAccessToken).mockResolvedValue({
      userId: "user_1",
      orgId: null,
      scopes: ["account:read"],
      clientId: "c1",
    });
    const res = await buildApp().request("/probe", {
      headers: { authorization: "Bearer jwt" },
    });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { kind: string }).kind).toBe("oauth");
  });

  it("returns 401 when no credentials", async () => {
    const res = await buildApp().request("/probe");
    expect(res.status).toBe(401);
  });
});
