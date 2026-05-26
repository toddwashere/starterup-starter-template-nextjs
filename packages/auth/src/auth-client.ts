import { createAuthClient } from "better-auth/react";
import { organizationClient, adminClient } from "better-auth/client/plugins";
import { ac, orgRoles } from "./org-roles";
import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { stripeClient } from "@better-auth/stripe/client";
import { keys as authKeys } from "../keys";

export const authClient = createAuthClient({
  baseURL: authKeys().NEXT_PUBLIC_BETTER_AUTH_URL,
  plugins: [
    organizationClient({ ac, roles: orgRoles }),
    adminClient(),
    apiKeyClient(),
    oauthProviderClient(),
    stripeClient({ subscription: true }),
  ],
  fetchOptions: { throw: true },
});

export type AuthClient = typeof authClient;
