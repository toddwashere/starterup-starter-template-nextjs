import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("better-auth/api", () => ({
  APIError: class APIError extends Error {
    constructor(
      public status: string,
      public body?: { code?: string; message?: string },
    ) {
      super(body?.message ?? status);
      this.name = "APIError";
    }
  },
}));

vi.mock("../auth", () => ({ auth: { api: { signUpEmail: vi.fn() } } }));

import { APIError } from "better-auth/api";
import { auth } from "../auth";
import { registerUserForPublicApi } from "./register-user";
import { PublicApiRegisterError } from "./types";

describe("registerUserForPublicApi", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only id, name, email on success (no token/password)", async () => {
    vi.mocked(auth.api.signUpEmail).mockResolvedValue({
      token: "secret-session-token",
      user: {
        id: "user_1",
        name: "Test User",
        email: "test@example.com",
        emailVerified: false,
        image: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    } as never);

    const result = await registerUserForPublicApi({
      name: "Test User",
      email: "test@example.com",
      password: "supersecret",
    });

    expect(result).toEqual({
      id: "user_1",
      name: "Test User",
      email: "test@example.com",
    });
    expect(result).not.toHaveProperty("token");
    expect(result).not.toHaveProperty("password");
  });

  it("maps duplicate-email APIError (USER_ALREADY_EXISTS) to sign-in hint", async () => {
    vi.mocked(auth.api.signUpEmail).mockRejectedValue(
      new APIError("UNPROCESSABLE_ENTITY", {
        code: "USER_ALREADY_EXISTS",
        message: "User already exists",
      }),
    );

    await expect(
      registerUserForPublicApi({
        name: "Test User",
        email: "dup@example.com",
        password: "supersecret",
      }),
    ).rejects.toMatchObject({
      name: "PublicApiRegisterError",
      code: "VALIDATION_ERROR",
      message: "An account with this email already exists. Sign in instead.",
    });
  });

  it("maps duplicate-email APIError detected by message fallback", async () => {
    vi.mocked(auth.api.signUpEmail).mockRejectedValue(
      new APIError("UNPROCESSABLE_ENTITY", {
        message: "User with this email already exists",
      }),
    );

    await expect(
      registerUserForPublicApi({
        name: "Test User",
        email: "dup@example.com",
        password: "supersecret",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "An account with this email already exists. Sign in instead.",
    });
  });

  it("passes through other APIError messages (weak password)", async () => {
    vi.mocked(auth.api.signUpEmail).mockRejectedValue(
      new APIError("BAD_REQUEST", {
        code: "PASSWORD_TOO_SHORT",
        message: "Password too short",
      }),
    );

    await expect(
      registerUserForPublicApi({
        name: "Test User",
        email: "weak@example.com",
        password: "short",
      }),
    ).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: "Password too short",
    });
    await expect(
      registerUserForPublicApi({
        name: "Test User",
        email: "weak@example.com",
        password: "short",
      }),
    ).rejects.toBeInstanceOf(PublicApiRegisterError);
  });

  it("re-throws non-APIError errors unchanged", async () => {
    const boom = new Error("network down");
    vi.mocked(auth.api.signUpEmail).mockRejectedValue(boom);

    await expect(
      registerUserForPublicApi({
        name: "Test User",
        email: "test@example.com",
        password: "supersecret",
      }),
    ).rejects.toBe(boom);
  });
});
