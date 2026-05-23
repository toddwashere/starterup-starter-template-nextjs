import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { organization, admin, jwt } from "better-auth/plugins";
import { apiKey } from "@better-auth/api-key";
import { oauthProvider } from "@better-auth/oauth-provider";
import { stripe } from "@better-auth/stripe";
import { APIError } from "better-auth/api";
import { prisma } from "@workspace/database";
import { getStripeClient } from "@workspace/billing/stripe-client";
import { stripePluginOptions } from "@workspace/billing/stripe-plugin-options";
import { ac, permissions } from "./permissions";
import { routeVerificationEmail } from "./email-routing";
import { sendPasswordResetEmail } from "@workspace/email/send-password-reset-email";
import { sendInvitationEmail } from "@workspace/email/send-invitation-email";
import { createBetterAuthId } from "./better-auth-id";

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: "postgresql" }),
  advanced: {
    database: {
      generateId: createBetterAuthId,
    },
  },
  experimental: { joins: true },
  user: {
    deleteUser: {
      enabled: true,
      beforeDelete: async (user) => {
        const customerId = (user as { stripeCustomerId?: string | null })
          .stripeCustomerId;
        if (!customerId) return;
        const subscriptions = await getStripeClient().subscriptions.list({
          customer: customerId,
          status: "all",
          limit: 100,
        });
        const NON_TERMINAL = new Set([
          "active",
          "trialing",
          "past_due",
          "unpaid",
          "incomplete",
          "paused",
        ]);
        const hasNonTerminal = subscriptions.data.some((s) =>
          NON_TERMINAL.has(s.status),
        );
        if (hasNonTerminal) {
          throw new APIError("BAD_REQUEST", {
            message:
              "Cannot delete your account while you have active subscriptions. Please cancel them first.",
          });
        }
      },
    },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    sendVerificationEmail: async ({
      user,
      url,
    }: {
      user: { email: string; name: string; emailVerified: boolean };
      url: string;
    }) => {
      await routeVerificationEmail({ user, url });
    },
    sendResetPasswordEmail: async ({
      user,
      url,
    }: {
      user: { email: string; name: string };
      url: string;
    }) => {
      await sendPasswordResetEmail({
        recipient: user.email,
        name: user.name,
        resetUrl: url,
      });
    },
  },
  socialProviders: {
    ...(process.env.GOOGLE_CLIENT_ID && {
      google: {
        clientId: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
      },
    }),
    ...(process.env.MICROSOFT_CLIENT_ID && {
      microsoft: {
        clientId: process.env.MICROSOFT_CLIENT_ID,
        clientSecret: process.env.MICROSOFT_CLIENT_SECRET!,
        tenantId: process.env.MICROSOFT_TENANT_ID || "common",
      },
    }),
  },
  plugins: [
    jwt(),
    oauthProvider({
      loginPage: "/sign-in",
      consentPage: "/consent",
      allowDynamicClientRegistration: true,
      // Public MCP clients (Claude, Cursor) register without a pre-created client.
      // Better Auth docs warn this behavior may change as MCP standards settle.
      allowUnauthenticatedClientRegistration: true,
      scopes: ["account:read", "offline_access"],
    }),
    organization({
      ac,
      roles: {
        owner: permissions.owner,
        admin: permissions.admin,
        member: permissions.member,
      },
      async sendInvitationEmail(data) {
        const baseUrl = process.env.BETTER_AUTH_URL ?? "http://localhost:4000";
        await sendInvitationEmail({
          recipient: data.email,
          organizationName: data.organization.name,
          inviterName: data.inviter.user.name,
          acceptUrl: `${baseUrl}/accept-invitation/${data.id}`,
        });
      },
    }),
    admin(),
    apiKey([
      {
        configId: "org-keys",
        defaultPrefix: "sk_org_",
        references: "organization",
        enableMetadata: true,
        rateLimit: {
          enabled: true,
          maxRequests: 1000,
          timeWindow: 1000 * 60 * 60,
        },
      },
      {
        configId: "user-keys",
        defaultPrefix: "sk_user_",
        references: "user",
        enableMetadata: true,
        rateLimit: {
          enabled: true,
          maxRequests: 1000,
          timeWindow: 1000 * 60 * 60,
        },
      },
    ]),
    stripe(stripePluginOptions(getStripeClient())),
  ],
});

export type Auth = typeof auth;
