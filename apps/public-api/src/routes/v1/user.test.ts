import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../lib/context";

vi.mock("@workspace/auth/public-api", () => ({
  getUserProfileForPublicApi: vi.fn(),
  listOrganizationsForUser: vi.fn(),
}));

import {
  getUserProfileForPublicApi,
  listOrganizationsForUser,
} from "@workspace/auth/public-api";
import { registerUserRoutes } from "./user";

const oauthContext = {
  kind: "oauth" as const,
  userId: "user_1",
  orgId: null,
  scopes: ["account:read"],
  clientId: null,
};

function buildApp(authContext: AppEnv["Variables"]["authContext"]) {
  const app = new OpenAPIHono<AppEnv>();
  app.use("/*", async (c, next) => {
    c.set("authContext", authContext);
    await next();
  });
  registerUserRoutes(app);
  return app;
}

describe("GET /v1/me", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns user profile for oauth", async () => {
    vi.mocked(getUserProfileForPublicApi).mockResolvedValue({
      id: "user_1",
      name: "Test",
      email: "test@example.com",
      image: null,
    });
    const res = await buildApp(oauthContext).request("/v1/me");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe("user_1");
    expect(body).not.toHaveProperty("token");
    expect(body).not.toHaveProperty("refresh");
    expect(body).not.toHaveProperty("activeOrganizationId");
  });

  it("returns 403 for api-key auth", async () => {
    const res = await buildApp({
      kind: "api-key",
      keyId: "k1",
      orgId: null,
      userId: "user_1",
      ownerType: "user",
      permissions: {},
    }).request("/v1/me");
    expect(res.status).toBe(403);
  });
});

describe("GET /v1/organizations", () => {
  it("returns organization list", async () => {
    vi.mocked(listOrganizationsForUser).mockResolvedValue([
      { id: "org_1", name: "Acme", slug: "acme", roles: ["member"] },
    ]);
    const res = await buildApp(oauthContext).request("/v1/organizations");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      organizations: [
        { id: "org_1", name: "Acme", slug: "acme", roles: ["member"] },
      ],
    });
  });

  it("returns empty list when user has no orgs", async () => {
    vi.mocked(listOrganizationsForUser).mockResolvedValue([]);
    const res = await buildApp(oauthContext).request("/v1/organizations");
    expect(await res.json()).toEqual({ organizations: [] });
  });
});
