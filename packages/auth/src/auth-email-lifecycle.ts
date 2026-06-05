import { routeVerificationEmail } from "./email-routing";
import { sendPasswordResetEmail } from "@workspace/email/send-password-reset-email";
import { sendInvitationEmail } from "@workspace/email/send-invitation-email";

type VerificationUser = {
  email: string;
  name: string;
  emailVerified: boolean;
};

export function createEmailVerificationOptions() {
  return {
    sendVerificationEmail: async (data: {
      user: VerificationUser;
      url: string;
      token: string;
    }) => {
      await routeVerificationEmail({ user: data.user, url: data.url });
    },
  };
}

export function createEmailAndPasswordOptions() {
  return {
    enabled: true as const,
    requireEmailVerification: false as const,
    sendResetPassword: async (data: {
      user: { email: string; name: string };
      url: string;
      token: string;
    }) => {
      await sendPasswordResetEmail({
        recipient: data.user.email,
        name: data.user.name,
        resetUrl: data.url,
      });
    },
  };
}

export function createOrganizationInvitationEmailHandler(baseUrl: string) {
  return async (data: {
    id: string;
    email: string;
    organization: { name: string };
    inviter: { user: { name: string } };
  }) => {
    await sendInvitationEmail({
      recipient: data.email,
      organizationName: data.organization.name,
      inviterName: data.inviter.user.name,
      acceptUrl: `${baseUrl}/accept-invitation/${data.id}`,
    });
  };
}

/**
 * Guardrail for Better Auth 1.6+ email lifecycle option names.
 * `sendResetPasswordEmail` moved to `emailAndPassword.sendResetPassword`;
 * `sendVerificationEmail` moved to top-level `emailVerification`.
 */
export function assertBetterAuthEmailLifecycleConfigured(options: {
  emailVerification?: { sendVerificationEmail?: unknown };
  emailAndPassword?: {
    sendResetPassword?: unknown;
    sendResetPasswordEmail?: unknown;
  };
}): void {
  if (typeof options.emailVerification?.sendVerificationEmail !== "function") {
    throw new Error(
      "emailVerification.sendVerificationEmail must be configured (Better Auth 1.6+)",
    );
  }
  if (typeof options.emailAndPassword?.sendResetPassword !== "function") {
    throw new Error(
      "emailAndPassword.sendResetPassword must be configured (Better Auth 1.6+)",
    );
  }
  if ("sendResetPasswordEmail" in (options.emailAndPassword ?? {})) {
    throw new Error(
      "emailAndPassword.sendResetPasswordEmail is deprecated; use sendResetPassword",
    );
  }
}
