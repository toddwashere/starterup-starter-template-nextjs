import type { MiddlewareHandler } from "hono";
import { verifyApiKey, ApiKeyError } from "@workspace/auth/api-keys";
import { verifyOAuthAccessToken } from "@workspace/auth/oauth/verify-access-token";
import type { PublicApiAuthContext } from "@workspace/auth/public-api";
import type { AppEnv } from "../lib/context";
import { errorResponse } from "../lib/errors";

export const resolveAuth: MiddlewareHandler<AppEnv> = async (c, next) => {
  const apiKeyHeader = c.req.header("x-api-key");
  if (apiKeyHeader) {
    try {
      const keyCtx = await verifyApiKey(apiKeyHeader);
      const authContext: PublicApiAuthContext = { kind: "api-key", ...keyCtx };
      c.set("authContext", authContext);
      await next();
      return;
    } catch (err) {
      if (err instanceof ApiKeyError) {
        const status = err.code === "RATE_LIMITED" ? 429 : 401;
        return errorResponse(c, status, err.code, err.message);
      }
      return errorResponse(c, 500, "INTERNAL_ERROR", "Internal server error");
    }
  }

  const authHeader = c.req.header("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    const token = authHeader.slice(7);
    const oauthCtx = await verifyOAuthAccessToken(token);
    if (!oauthCtx) {
      return errorResponse(c, 401, "UNAUTHORIZED", "Invalid token");
    }
    c.set("authContext", { kind: "oauth", ...oauthCtx });
    await next();
    return;
  }

  return errorResponse(c, 401, "UNAUTHORIZED", "Missing authentication");
};
