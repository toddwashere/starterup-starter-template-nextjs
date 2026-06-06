import { createId, type AuthIdPrefix } from "@workspace/common/create-id";

type BetterAuthGenerateIdOptions = {
  model?: string;
};

const betterAuthModelIdPrefixes: Record<string, AuthIdPrefix> = {
  user: "user",
  session: "sess",
  account: "acct",
  verification: "ver",
  jwks: "jwks",
  organization: "org",
  member: "mbr",
  invitation: "authinv",
  apikey: "apikey",
  apiKey: "apikey",
  oauthClient: "oauthclient",
  oauthAccessToken: "oauthat",
  oauthRefreshToken: "oauthrt",
  oauthConsent: "oauthc",
};

export function createBetterAuthId(options: BetterAuthGenerateIdOptions) {
  const prefix = options.model
    ? betterAuthModelIdPrefixes[options.model]
    : undefined;

  return prefix ? createId(prefix) : createId();
}
