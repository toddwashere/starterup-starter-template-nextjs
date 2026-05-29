import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import type { PublicApiAuthContext } from "@workspace/auth/public-api";
import type { AppEnv } from "../lib/context";
import { requireScope } from "./require-scope";

function buildApp(authContext: PublicApiAuthContext) {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("authContext", authContext);
    await next();
  });
  app.use("*", requireScope("account:read"));
  app.get("/probe", (c) => c.json({ ok: true }));
  return app;
}

const oauth = (scopes: string[]): PublicApiAuthContext => ({
  kind: "oauth",
  userId: "user_1",
  orgId: null,
  scopes,
  clientId: null,
});

const apiKey = (): PublicApiAuthContext => ({
  kind: "api-key",
  keyId: "k1",
  orgId: null,
  userId: "user_1",
  ownerType: "user",
  permissions: {},
});

describe("requireScope", () => {
  it("returns 403 when oauth context lacks the required scope", async () => {
    const res = await buildApp(oauth([])).request("/probe");
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: { code: "FORBIDDEN", message: "Insufficient scope" },
    });
  });

  it("passes through when oauth context has the required scope", async () => {
    const res = await buildApp(oauth(["account:read"])).request("/probe");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("passes when oauth context has at least one of the listed scopes", async () => {
    const app = new Hono<AppEnv>();
    app.use("*", async (c, next) => {
      c.set("authContext", oauth(["account:write"]));
      await next();
    });
    app.use("*", requireScope("account:read", "account:write"));
    app.get("/probe", (c) => c.json({ ok: true }));
    const res = await app.request("/probe");
    expect(res.status).toBe(200);
  });

  it("bypasses the scope check for api-key contexts", async () => {
    const res = await buildApp(apiKey()).request("/probe");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
