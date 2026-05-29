import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/context";
import { errorResponse } from "../lib/errors";

export function requireScope(...scopes: string[]): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const authContext = c.get("authContext");

    // Integration (api-key) auth uses permissions, not OAuth scopes.
    if (authContext.kind === "api-key") {
      return next();
    }

    const hasScope = scopes.some((scope) =>
      authContext.scopes.includes(scope),
    );
    if (!hasScope) {
      return errorResponse(c, 403, "FORBIDDEN", "Insufficient scope");
    }

    return next();
  };
}
