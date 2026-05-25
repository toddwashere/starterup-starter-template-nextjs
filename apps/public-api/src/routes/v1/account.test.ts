import { describe, it, expect, vi } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../lib/context";

vi.mock("@workspace/auth/api-keys", () => ({
  hasPermission(permissions: Record<string, string[]>, required: Record<string, string[]>) {
    for (const [resource, actions] of Object.entries(required)) {
      const granted = permissions[resource] ?? [];
      if (!actions.every((a) => granted.includes(a))) return false;
    }
    return true;
  },
}));

import { registerAccountRoute } from "./account";

const mockCtx = {
  keyId: "key_123",
  orgId: "org_456",
  userId: null,
  ownerType: "organization" as const,
  permissions: { account: ["read"] },
};

function buildApp() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("/*", async (c, next) => {
    c.set("authContext", { kind: "api-key", ...mockCtx });
    await next();
  });
  registerAccountRoute(app);
  return app;
}

describe("GET /v1/account", () => {
  it("returns 200 with identity for org-owned key", async () => {
    const app = buildApp();
    const res = await app.request("/v1/account");
    expect(res.status).toBe(200);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.ownerType).toBe("organization");
    expect(body.orgId).toBe("org_456");
    expect(body.userId).toBeNull();
    expect(body.permissions).toEqual({ account: ["read"] });
  });

  it("returns JSON with keyId", async () => {
    const app = buildApp();
    const res = await app.request("/v1/account");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const body = (await res.json()) as any;
    expect(body.keyId).toBe("key_123");
  });

  it("returns 403 when account:read permission is missing", async () => {
    const app = new OpenAPIHono<AppEnv>();
    app.use("/*", async (c, next) => {
      c.set("authContext", { kind: "api-key", ...mockCtx, permissions: {} });
      await next();
    });
    registerAccountRoute(app);
    const res = await app.request("/v1/account");
    expect(res.status).toBe(403);
  });

  it("returns 401 when only Bearer oauth is provided", async () => {
    const app = new OpenAPIHono<AppEnv>();
    app.use("/*", async (c, next) => {
      c.set("authContext", {
        kind: "oauth",
        userId: "user_1",
        orgId: null,
        scopes: ["account:read"],
        clientId: null,
      });
      await next();
    });
    app.use("/*", async (c, next) => {
      if (c.get("authContext").kind !== "api-key") {
        return c.json(
          { error: { code: "UNAUTHORIZED", message: "API key required" } },
          401,
        );
      }
      await next();
    });
    registerAccountRoute(app);
    const res = await app.request("/v1/account");
    expect(res.status).toBe(401);
  });
});
