import { describe, it, expect, vi, beforeEach } from "vitest";
import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../lib/context";

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
}));

import {
  registerUserForPublicApi,
  PublicApiRegisterError,
} from "@workspace/auth/public-api";
import { registerAuthRoutes } from "./auth";

function buildApp() {
  const app = new OpenAPIHono<AppEnv>();
  registerAuthRoutes(app);
  return app;
}

function post(body: unknown) {
  return buildApp().request("/v1/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const validBody = {
  name: "Test User",
  email: "test@example.com",
  password: "supersecret",
};

describe("POST /v1/auth/register", () => {
  beforeEach(() => vi.clearAllMocks());

  it("registers a new user -> 201 with user envelope", async () => {
    vi.mocked(registerUserForPublicApi).mockResolvedValue({
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
    });

    const res = await post(validBody);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: Record<string, unknown> };
    expect(body).toEqual({
      user: { id: "user_1", name: "Test User", email: "test@example.com" },
    });
    expect(body.user).not.toHaveProperty("token");
    expect(body.user).not.toHaveProperty("password");
  });

  it("returns 400 VALIDATION_ERROR with sign-in hint on duplicate email", async () => {
    vi.mocked(registerUserForPublicApi).mockRejectedValue(
      new PublicApiRegisterError(
        "VALIDATION_ERROR",
        "An account with this email already exists. Sign in instead.",
      ),
    );

    const res = await post(validBody);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message:
          "An account with this email already exists. Sign in instead.",
      },
    });
  });

  it("returns 400 VALIDATION_ERROR on short password (zod validation)", async () => {
    const res = await post({ ...validBody, password: "short" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(registerUserForPublicApi).not.toHaveBeenCalled();
  });

  it("returns 400 VALIDATION_ERROR on invalid email (zod validation)", async () => {
    const res = await post({ ...validBody, email: "not-an-email" });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("VALIDATION_ERROR");
    expect(registerUserForPublicApi).not.toHaveBeenCalled();
  });
});
