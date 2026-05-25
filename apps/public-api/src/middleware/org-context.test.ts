import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import type { AppEnv } from "../lib/context";

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
import { orgContext } from "./org-context";

function buildApp() {
  const app = new Hono<AppEnv>();
  app.use("/orgs/:orgId/*", async (c, next) => {
    c.set("authContext", {
      kind: "oauth",
      userId: "user_1",
      orgId: null,
      scopes: ["account:read"],
      clientId: null,
    });
    await next();
  });
  app.use("/orgs/:orgId/*", orgContext);
  app.get("/orgs/:orgId/ping", (c) =>
    c.json({ orgId: c.get("orgId"), role: c.get("orgRole") }),
  );
  return app;
}

describe("orgContext", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sets orgId and role for members", async () => {
    vi.mocked(assertUserOrgMember).mockResolvedValue("admin");
    const res = await buildApp().request("/orgs/org_1/ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "org_1", role: "admin" });
  });

  it("returns 403 for non-members", async () => {
    vi.mocked(assertUserOrgMember).mockRejectedValue(
      new PublicApiOrgError("FORBIDDEN", "Not a member"),
    );
    const res = await buildApp().request("/orgs/org_2/ping");
    expect(res.status).toBe(403);
  });
});
