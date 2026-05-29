import { createRoute, z, OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../lib/context";
import { errorResponse } from "../../lib/errors";
import { ErrorResponseSchema } from "../../lib/openapi-schemas";

const PingResponseSchema = z.object({
  orgId: z.string(),
  roles: z.array(z.string()),
});

const pingRoute = createRoute({
  method: "get",
  path: "/v1/orgs/{orgId}/ping",
  security: [{ bearerAuth: [] }],
  tags: ["Organization"],
  request: {
    params: z.object({ orgId: z.string() }),
  },
  responses: {
    200: {
      content: { "application/json": { schema: PingResponseSchema } },
      description: "Org context probe (stub for org-scoped routes)",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Missing organization context",
    },
    401: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Unauthorized",
    },
    403: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Forbidden",
    },
  },
});

export function registerOrgRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(pingRoute, (c) => {
    const orgId = c.get("orgId");
    const orgRoles = c.get("orgRoles");
    if (!orgId || !orgRoles || orgRoles.length === 0) {
      return errorResponse(c, 400, "VALIDATION_ERROR", "Missing organization context");
    }
    return c.json({ orgId, roles: orgRoles }, 200);
  });
}
