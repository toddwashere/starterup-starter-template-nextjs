import { createRoute, z, OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../lib/context";
import { errorResponse } from "../../lib/errors";

const PingResponseSchema = z.object({
  orgId: z.string(),
  role: z.string(),
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
    403: { description: "Forbidden" },
  },
});

export function registerOrgRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(pingRoute, (c) => {
    const orgId = c.get("orgId");
    const orgRole = c.get("orgRole");
    if (!orgId || !orgRole) {
      return errorResponse(c, 400, "VALIDATION_ERROR", "Missing organization context");
    }
    return c.json({ orgId, role: orgRole }, 200);
  });
}
