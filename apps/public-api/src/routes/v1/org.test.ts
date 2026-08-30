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

const { TestInsufficientCreditsError } = vi.hoisted(() => ({
  TestInsufficientCreditsError: class extends Error {
    readonly code = "INSUFFICIENT_CREDITS";
    constructor(readonly balanceCredits: number) {
      super("Insufficient credits");
      this.name = "InsufficientCreditsError";
    }
  },
}));

vi.mock("@workspace/credits", () => ({
  creditsConfig: { policy: { chargeToOrgDefault: false } },
  InsufficientCreditsError: TestInsufficientCreditsError,
  runWithCreditCharge: vi.fn(async ({ run }) => run()),
}));

import { runWithCreditCharge } from "@workspace/credits";
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
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(runWithCreditCharge).mockImplementation((({ run }: { run: () => Promise<unknown> }) =>
      run()) as unknown as typeof runWithCreditCharge);
  });

  it("returns orgId and roles for members", async () => {
    vi.mocked(assertUserOrgMember).mockResolvedValue(["member"]);
    const res = await buildApp().request("/v1/orgs/org_1/ping");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ orgId: "org_1", roles: ["member"] });
  });

  it("meters the org-scoped route against the path organization", async () => {
    vi.mocked(assertUserOrgMember).mockResolvedValue(["member"]);
    const res = await buildApp().request("/v1/orgs/org_1/ping", {
      headers: { "Idempotency-Key": "req_1" },
    });

    expect(res.status).toBe(200);
    expect(runWithCreditCharge).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org_1",
        source: "public_api",
        usageArea: "api_route",
        chargeToOrg: false,
        cost: { mode: "fixed", credits: 1 },
        idempotencyKey: "public_api:GET /v1/orgs/{orgId}/ping:req_1",
      }),
    );
  });

  it("returns 402 INSUFFICIENT_CREDITS when the org cannot pay", async () => {
    vi.mocked(assertUserOrgMember).mockResolvedValue(["member"]);
    vi.mocked(runWithCreditCharge).mockRejectedValueOnce(new TestInsufficientCreditsError(0));

    const res = await buildApp().request("/v1/orgs/org_1/ping");

    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      error: { code: "INSUFFICIENT_CREDITS", message: "Insufficient credits" },
    });
  });

  it("returns 403 for non-members", async () => {
    vi.mocked(assertUserOrgMember).mockRejectedValue(
      new PublicApiOrgError("FORBIDDEN", "Not a member"),
    );
    const res = await buildApp().request("/v1/orgs/org_2/ping");
    expect(res.status).toBe(403);
  });
});
