import { createAuthClient } from "better-auth/react";
import { organizationClient, adminClient } from "better-auth/client/plugins";
import { ac, orgRoles } from "./org-roles";
import { apiKeyClient } from "@better-auth/api-key/client";
import { oauthProviderClient } from "@better-auth/oauth-provider/client";
import { stripeClient } from "@better-auth/stripe/client";
import { fallbackAuthUrl, resolveAuthClientBaseURL } from "./auth-base-url";

export const authClient = createAuthClient({
  // Same-origin: Better Auth is served by the dashboard. Using the page origin
  // prevents a missing/localhost NEXT_PUBLIC_* bake from calling loopback in
  // production (Chrome "access other apps and services on this device").
  baseURL: resolveAuthClientBaseURL({
    configured: fallbackAuthUrl(),
    currentOrigin: (globalThis as { location?: { origin?: string } }).location?.origin,
  }),
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

/**
 * Better Auth refreshes the session atom on sign-in/sign-up but does not
 * notify `$listOrg`. Call after auth transitions so organization lists refetch.
 */
export function invalidateOrganizationList(): void {
  authClient.$store.notify("$listOrg");
}
