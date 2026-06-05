import { describe, it, expect, vi, beforeEach } from "vitest";
import { getTestInstance } from "better-auth/test";

const mockRouteVerificationEmail = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const mockSendPasswordResetEmail = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);
const mockSendInvitationEmail = vi.hoisted(() =>
  vi.fn().mockResolvedValue(undefined),
);

vi.mock("./email-routing", () => ({
  routeVerificationEmail: mockRouteVerificationEmail,
}));

vi.mock("@workspace/email/send-password-reset-email", () => ({
  sendPasswordResetEmail: mockSendPasswordResetEmail,
}));

vi.mock("@workspace/email/send-invitation-email", () => ({
  sendInvitationEmail: mockSendInvitationEmail,
}));

import {
  assertBetterAuthEmailLifecycleConfigured,
  createEmailAndPasswordOptions,
  createEmailVerificationOptions,
  createOrganizationInvitationEmailHandler,
} from "./auth-email-lifecycle";

function createResetUser(overrides: { email?: string; name?: string } = {}) {
  return {
    id: "user_123",
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    email: "user@example.com",
    emailVerified: false,
    name: "Jane",
    ...overrides,
  };
}

describe("assertBetterAuthEmailLifecycleConfigured", () => {
  it("passes when Better Auth 1.6+ email hooks are wired", () => {
    expect(() =>
      assertBetterAuthEmailLifecycleConfigured({
        emailVerification: { sendVerificationEmail: async () => {} },
        emailAndPassword: { sendResetPassword: async () => {} },
      }),
    ).not.toThrow();
  });

  it("fails when sendResetPassword is missing", () => {
    expect(() =>
      assertBetterAuthEmailLifecycleConfigured({
        emailVerification: { sendVerificationEmail: async () => {} },
        emailAndPassword: {},
      }),
    ).toThrow(/sendResetPassword must be configured/);
  });

  it("fails when sendVerificationEmail is missing from emailVerification", () => {
    expect(() =>
      assertBetterAuthEmailLifecycleConfigured({
        emailVerification: {},
        emailAndPassword: { sendResetPassword: async () => {} },
      }),
    ).toThrow(/emailVerification\.sendVerificationEmail must be configured/);
  });

  it("fails when deprecated sendResetPasswordEmail is still present", () => {
    expect(() =>
      assertBetterAuthEmailLifecycleConfigured({
        emailVerification: { sendVerificationEmail: async () => {} },
        emailAndPassword: {
          sendResetPassword: async () => {},
          sendResetPasswordEmail: async () => {},
        },
      }),
    ).toThrow(/sendResetPasswordEmail is deprecated/);
  });
});

describe("auth email lifecycle handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("sendVerificationEmail routes through routeVerificationEmail", async () => {
    const { sendVerificationEmail } = createEmailVerificationOptions();

    await sendVerificationEmail({
      user: {
        email: "user@example.com",
        name: "Jane",
        emailVerified: false,
      },
      url: "https://app.example.com/verify?token=abc",
      token: "abc",
    });

    expect(mockRouteVerificationEmail).toHaveBeenCalledWith({
      user: {
        email: "user@example.com",
        name: "Jane",
        emailVerified: false,
      },
      url: "https://app.example.com/verify?token=abc",
    });
  });

  it("sendResetPassword sends password reset email", async () => {
    const { sendResetPassword } = createEmailAndPasswordOptions();

    await sendResetPassword({
      user: createResetUser(),
      url: "https://app.example.com/reset?token=xyz",
      token: "xyz",
    });

    expect(mockSendPasswordResetEmail).toHaveBeenCalledWith({
      recipient: "user@example.com",
      name: "Jane",
      resetUrl: "https://app.example.com/reset?token=xyz",
    });
  });

  it("sendResetPassword fails clearly when Better Auth omits user email", async () => {
    const { sendResetPassword } = createEmailAndPasswordOptions();

    await expect(
      sendResetPassword({
        user: createResetUser({ email: undefined }),
        url: "https://app.example.com/reset?token=xyz",
        token: "xyz",
      }),
    ).rejects.toThrow(/missing user email/i);

    expect(mockSendPasswordResetEmail).not.toHaveBeenCalled();
  });

  it("sendInvitationEmail sends org invitation email", async () => {
    const sendInvitationEmailHandler =
      createOrganizationInvitationEmailHandler("http://localhost:4000");

    await sendInvitationEmailHandler({
      id: "inv_123",
      email: "new@example.com",
      organization: { name: "Acme" },
      inviter: { user: { name: "Owner" } },
    });

    expect(mockSendInvitationEmail).toHaveBeenCalledWith({
      recipient: "new@example.com",
      organizationName: "Acme",
      inviterName: "Owner",
      acceptUrl: "http://localhost:4000/accept-invitation/inv_123",
    });
  });
});

describe("Better Auth request-password-reset integration", () => {
  it("does not return RESET_PASSWORD_DISABLED when sendResetPassword is wired", async () => {
    const sendResetPassword = vi.fn().mockResolvedValue(undefined);

    const { auth, client } = await getTestInstance({
      emailVerification: createEmailVerificationOptions(),
      emailAndPassword: {
        ...createEmailAndPasswordOptions(),
        sendResetPassword,
      },
    });

    await client.signUp.email({
      email: "reset@example.com",
      password: "password123",
      name: "Reset User",
    });

    const result = await auth.api.requestPasswordReset({
      body: { email: "reset@example.com" },
    });

    expect(result).toMatchObject({
      status: true,
      message: expect.stringContaining("check your email"),
    });
    expect(sendResetPassword).toHaveBeenCalledOnce();
    expect(sendResetPassword).toHaveBeenCalledWith(
      expect.objectContaining({
        user: expect.objectContaining({ email: "reset@example.com" }),
        url: expect.stringContaining("/reset-password/"),
        token: expect.any(String),
      }),
      undefined,
    );
  });
});
