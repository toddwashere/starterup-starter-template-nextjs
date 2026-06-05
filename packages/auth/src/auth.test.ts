import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {},
}));

vi.mock("@workspace/billing/stripe-plugin-options", () => ({
  stripePluginOptions: () => ({}),
}));

vi.mock("@workspace/billing/stripe-client", () => ({
  getStripeClient: () => ({
    subscriptions: { list: vi.fn().mockResolvedValue({ data: [] }) },
  }),
}));

vi.mock("@workspace/worker-queue", () => ({
  enqueue: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./email-routing", () => ({
  routeVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/email/send-password-reset-email", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/email/send-invitation-email", () => ({
  sendInvitationEmail: vi.fn().mockResolvedValue(undefined),
}));

import { auth } from "./auth";
import { assertBetterAuthEmailLifecycleConfigured } from "./auth-email-lifecycle";

describe("auth instance email lifecycle config", () => {
  it("wires Better Auth 1.6+ password reset and verification hooks", () => {
    expect(() => assertBetterAuthEmailLifecycleConfigured(auth.options)).not.toThrow();
    expect(auth.options.emailAndPassword?.sendResetPassword).toBeTypeOf("function");
    expect(auth.options.emailVerification?.sendVerificationEmail).toBeTypeOf(
      "function",
    );
  });
});
