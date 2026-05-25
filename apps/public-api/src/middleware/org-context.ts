import type { MiddlewareHandler } from "hono";
import {
  assertUserOrgMember,
  PublicApiOrgError,
} from "@workspace/auth/public-api";
import type { AppEnv } from "../lib/context";
import { errorResponse } from "../lib/errors";

export const orgContext: MiddlewareHandler<AppEnv> = async (c, next) => {
  const orgId = c.req.param("orgId");
  if (!orgId) {
    return errorResponse(c, 400, "VALIDATION_ERROR", "Missing organization id");
  }

  const authContext = c.get("authContext");
  if (authContext.kind !== "oauth") {
    return errorResponse(
      c,
      403,
      "FORBIDDEN",
      "OAuth Bearer required for organization routes",
    );
  }

  try {
    const role = await assertUserOrgMember(authContext.userId, orgId);
    c.set("orgId", orgId);
    c.set("orgRole", role);
    await next();
  } catch (err) {
    if (err instanceof PublicApiOrgError) {
      if (err.code === "BAD_REQUEST") {
        return errorResponse(c, 400, "VALIDATION_ERROR", err.message);
      }
      return errorResponse(c, 403, "FORBIDDEN", err.message);
    }
    throw err;
  }
};
