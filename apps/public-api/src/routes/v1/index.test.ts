import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/credits", () => ({
  creditsConfig: { policy: { chargeToOrgDefault: false } },
  InsufficientCreditsError: class extends Error {},
  runWithCreditCharge: vi.fn(async ({ run }) => run()),
}));

vi.mock("@workspace/auth/public-api", () => ({
  registerUserForPublicApi: vi.fn(),
  PublicApiRegisterError: class PublicApiRegisterError extends Error {
    constructor(
      public code: "VALIDATION_ERROR",
      message: string,
    ) {
      super(message);
      this.name = "PublicApiRegisterError";
    }
  },
  getUserProfileForPublicApi: vi.fn(),
  listOrganizationsForUser: vi.fn(),
  assertUserOrgMember: vi.fn(),
  PublicApiOrgError: class PublicApiOrgError extends Error {
    constructor(
      public code: "BAD_REQUEST" | "FORBIDDEN",
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@workspace/auth/api-keys", () => ({
  verifyApiKey: vi.fn(),
  hasPermission: vi.fn(),
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

import { registerUserForPublicApi } from "@workspace/auth/public-api";
import { createV1Router } from "./index";

const validBody = {
  name: "Test User",
  email: "test@example.com",
  password: "supersecret",
};

describe("createV1Router routing", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /v1/auth/register is public (201 with no auth headers)", async () => {
    vi.mocked(registerUserForPublicApi).mockResolvedValue({
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
    });

    const res = await createV1Router().request("/v1/auth/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(validBody),
    });

    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({
      user: { id: "user_1", name: "Test User", email: "test@example.com" },
    });
    expect(registerUserForPublicApi).toHaveBeenCalledOnce();
  });

  it("GET /v1/me without auth returns 401 (still protected)", async () => {
    const res = await createV1Router().request("/v1/me");
    expect(res.status).toBe(401);
  });

  it("GET /v1/organizations without auth returns 401 (still protected)", async () => {
    const res = await createV1Router().request("/v1/organizations");
    expect(res.status).toBe(401);
  });

  it("GET /v1/account without api key returns 401 (still protected)", async () => {
    const res = await createV1Router().request("/v1/account");
    expect(res.status).toBe(401);
  });

  it("GET /v1/orgs/:orgId/ping without auth returns 401 (still protected)", async () => {
    const res = await createV1Router().request("/v1/orgs/org_1/ping");
    expect(res.status).toBe(401);
  });
});
