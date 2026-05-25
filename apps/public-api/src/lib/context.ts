import type { Context } from "hono";
import type { ApiKeyContext } from "@workspace/auth/api-keys";
import type { PublicApiAuthContext } from "@workspace/auth/public-api";

export type AppEnv = {
  Variables: {
    authContext: PublicApiAuthContext;
    orgId?: string;
    orgRoles?: string[];
  };
};

export function getAuthContext(c: Context<AppEnv>): PublicApiAuthContext {
  return c.get("authContext");
}

export function getApiKeyContext(c: Context<AppEnv>): ApiKeyContext {
  const ctx = c.get("authContext");
  if (ctx.kind !== "api-key") {
    throw new Error("API key context required");
  }
  return ctx;
}

export function getOAuthContext(c: Context<AppEnv>) {
  const ctx = c.get("authContext");
  if (ctx.kind !== "oauth") {
    throw new Error("OAuth context required");
  }
  return ctx;
}
