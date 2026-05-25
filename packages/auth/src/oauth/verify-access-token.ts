import { auth } from "../auth";

export type OAuthAccessTokenContext = {
  userId: string;
  orgId: string | null;
  scopes: string[];
  clientId: string | null;
};

export async function verifyOAuthAccessToken(
  token: string,
): Promise<OAuthAccessTokenContext | null> {
  try {
    const { oauthProviderResourceClient } = await import(
      "@better-auth/oauth-provider/resource-client"
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client = oauthProviderResourceClient(auth as any);
    const verifyFn = client.getActions().verifyAccessToken as (
      t: string,
    ) => Promise<Record<string, unknown>>;
    const payload = await verifyFn(token);
    const sub = payload["sub"];
    if (typeof sub !== "string") return null;
    const scope = payload["scope"];
    const clientId = payload["client_id"] ?? payload["azp"] ?? null;
    const orgId = payload["orgId"] ?? null;
    return {
      userId: sub,
      orgId: typeof orgId === "string" ? orgId : null,
      scopes:
        typeof scope === "string" ? scope.split(" ").filter(Boolean) : [],
      clientId: typeof clientId === "string" ? clientId : null,
    };
  } catch {
    return null;
  }
}
