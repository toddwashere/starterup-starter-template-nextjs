import type { IncomingMessage } from "node:http";
import { verifyApiKey, ApiKeyError } from "@workspace/auth/api-keys";
import { verifyOAuthAccessToken } from "@workspace/auth/oauth/verify-access-token";
import { auth } from "@workspace/auth";
import type { AuthContext } from "../lib/context";
import { McpAuthError } from "../lib/errors";

export { McpAuthError } from "../lib/errors";

function orgRoleToPermissions(_role: string): Record<string, string[]> {
  return { account: ["read"] };
}

async function resolveSessionContext(
  headers: Headers,
): Promise<AuthContext | null> {
  const session = await auth.api.getSession({ headers });
  if (!session) return null;
  return {
    kind: "session",
    userId: session.user.id,
    orgId: session.session.activeOrganizationId ?? null,
    permissions: orgRoleToPermissions("member"),
  };
}

async function resolveOAuthContext(
  token: string,
): Promise<AuthContext | null> {
  const ctx = await verifyOAuthAccessToken(token);
  if (!ctx) return null;
  return {
    kind: "oauth",
    userId: ctx.userId,
    orgId: ctx.orgId,
    scopes: ctx.scopes,
    clientId: ctx.clientId,
  };
}

export async function resolveMcpAuthContext(
  req: IncomingMessage,
): Promise<AuthContext> {
  // 1. API key via x-api-key header (external clients, backward compat)
  const apiKey = req.headers["x-api-key"];
  if (typeof apiKey === "string") {
    try {
      const ctx = await verifyApiKey(apiKey);
      return { kind: "api-key", ...ctx };
    } catch (err) {
      if (err instanceof ApiKeyError) {
        throw new McpAuthError(err.code, err.message);
      }
      throw new McpAuthError("UNAUTHORIZED", "Invalid API key");
    }
  }

  // 2. Bearer token — try OAuth JWT first, then fall back to session bearer
  const authHeader = req.headers["authorization"];
  if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
    const token = authHeader.slice(7);

    const oauthCtx = await resolveOAuthContext(token);
    if (oauthCtx) return oauthCtx;

    // Fallback: session token (dashboard test panel compatibility)
    const sessionCtx = await resolveSessionContext(
      new Headers({ authorization: authHeader }),
    );
    if (sessionCtx) return sessionCtx;

    throw new McpAuthError("UNAUTHORIZED", "Invalid token");
  }

  // 3. Session via Cookie (dashboard server actions forward cookies)
  const cookie = req.headers["cookie"];
  if (typeof cookie === "string") {
    const ctx = await resolveSessionContext(new Headers({ cookie }));
    if (ctx) return ctx;
  }

  throw new McpAuthError("UNAUTHORIZED", "Missing authentication");
}
