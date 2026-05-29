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

  // better-auth 1.6.11 throws APIError.from("UNPROCESSABLE_ENTITY",
  // BASE_ERROR_CODES.USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL) on duplicate
  // sign-up: body.code === "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
  // message "User already exists. Use another email."
  it("maps duplicate-email APIError (USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL) to sign-in hint", async () => {
    vi.mocked(auth.api.signUpEmail).mockRejectedValue(
      new APIError("UNPROCESSABLE_ENTITY", {
        code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
        message: "User already exists. Use another email.",
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

  // Proves the CODE path works independently of the message regex: the real
  // better-auth code is present but the message does NOT contain "already
  // exists", so detection must succeed on code alone.
  it("maps duplicate-email APIError by code alone (message does not match regex)", async () => {
    vi.mocked(auth.api.signUpEmail).mockRejectedValue(
      new APIError("UNPROCESSABLE_ENTITY", {
        code: "USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL",
        message: "Conflict",
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

  // Proves the MESSAGE fallback still works independently: no/unknown code,
  // but the message matches the /already exists/i regex.
  it("maps duplicate-email APIError by message fallback (no code)", async () => {
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
