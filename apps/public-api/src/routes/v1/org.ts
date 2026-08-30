import { createRoute, z, OpenAPIHono } from "@hono/zod-openapi";
import { creditsConfig } from "@workspace/credits";
import type { AppEnv } from "../../lib/context";
import { errorResponse } from "../../lib/errors";
import { ErrorResponseSchema } from "../../lib/openapi-schemas";
import { isInsufficientCreditsError, runPublicApiWithCredits } from "../../middleware/credits";

const PingResponseSchema = z.object({
  orgId: z.string(),
  roles: z.array(z.string()),
});

const PING_CREDIT_COST = { mode: "fixed", credits: 1 } as const;

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
    402: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Insufficient credits",
    },
    403: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Forbidden",
    },
  },
});

export function registerOrgRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(pingRoute, async (c) => {
    const orgId = c.get("orgId");
    const orgRoles = c.get("orgRoles");
    if (!orgId || !orgRoles || orgRoles.length === 0) {
      return errorResponse(c, 400, "VALIDATION_ERROR", "Missing organization context");
    }

    // Credit-metered org-scoped work. `chargeToOrgDefault` keeps this
    // observe-only until metering is proven (rollout step 6).
    try {
      const body = await runPublicApiWithCredits({
        authContext: c.get("authContext"),
        organizationId: orgId,
        routeId: "GET /v1/orgs/{orgId}/ping",
        usageArea: "api_route",
        chargeToOrg: creditsConfig.policy.chargeToOrgDefault,
        cost: PING_CREDIT_COST,
        idempotencyKey: c.req.header("Idempotency-Key"),
        run: async () => ({ orgId, roles: orgRoles }),
      });
      return c.json(body, 200);
    } catch (err) {
      if (isInsufficientCreditsError(err)) {
        return errorResponse(c, 402, "INSUFFICIENT_CREDITS", "Insufficient credits");
      }
      throw err;
    }
  });
}
