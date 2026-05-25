import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../lib/context";
import { orgContext } from "../../middleware/org-context";

vi.mock("@workspace/auth/public-api", () => ({
  assertUserOrgMember: vi.fn(),
  PublicApiOrgError: class PublicApiOrgError extends Error {
    constructor(
      public code: "FORBIDDEN" | "BAD_REQUEST",
      message: string,
    ) {
      super(message);
      this.name = "PublicApiOrgError";
    }
  },
}));

import { assertUserOrgMember, PublicApiOrgError } from "@workspace/auth/public-api";
import { registerOrgRoutes } from "./org";

function buildApp() {
  const app = new OpenAPIHono<AppEnv>();
  app.use("/v1/orgs/:orgId/*", async (c, next) => {
    c.set("authContext", {
      kind: "oauth",
      userId: "user_1",
      orgId: null,
      scopes: ["account:read"],
      clientId: null,
    });
    await next();
  });
  app.use("/v1/orgs/:orgId/*", orgContext);
  registerOrgRoutes(app);
  return app;
}

describe("GET /v1/orgs/{orgId}/ping", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns orgId and role for members", async () => {
    vi.mocked(assertUserOrgMember).mockResolvedValue("member");
    const res = await buildApp().request("/v1/orgs/org_1/ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "org_1", role: "member" });
  });

  it("returns 403 for non-members", async () => {
    vi.mocked(assertUserOrgMember).mockRejectedValue(
      new PublicApiOrgError("FORBIDDEN", "Not a member"),
    );
    const res = await buildApp().request("/v1/orgs/org_2/ping");
    expect(res.status).toBe(403);
  });
});
