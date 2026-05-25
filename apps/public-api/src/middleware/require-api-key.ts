import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../lib/context";
import { errorResponse } from "../lib/errors";

export const requireApiKey: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("authContext").kind !== "api-key") {
    return errorResponse(c, 401, "UNAUTHORIZED", "API key required");
  }
  await next();
};
