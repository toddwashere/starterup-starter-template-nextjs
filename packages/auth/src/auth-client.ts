import { createAuthClient } from "better-auth/react";
import { organizationClient, adminClient } from "better-auth/client/plugins";
import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { stripeClient } from "@better-auth/stripe/client";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL ?? "http://localhost:4000",
  plugins: [
    organizationClient(),
    adminClient(),
    apiKeyClient(),
    oauthProviderClient(),
    stripeClient({ subscription: true }),
  ],
  fetchOptions: { throw: true },
});

export type AuthClient = typeof authClient;
