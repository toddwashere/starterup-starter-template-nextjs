import { createRoute, z, OpenAPIHono } from "@hono/zod-openapi";
import {
  getUserProfileForPublicApi,
  listOrganizationsForUser,
} from "@workspace/auth/public-api";
import type { AppEnv } from "../../lib/context";
import { getOAuthContext } from "../../lib/context";
import { errorResponse } from "../../lib/errors";
import { ErrorResponseSchema } from "../../lib/openapi-schemas";

const MeResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
});

const OrganizationSchema = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  roles: z.array(z.string()),
});

const OrganizationsResponseSchema = z.object({
  organizations: z.array(OrganizationSchema),
});

const meRoute = createRoute({
  method: "get",
  path: "/v1/me",
  security: [{ bearerAuth: [] }],
  tags: ["User"],
  responses: {
    200: {
      content: { "application/json": { schema: MeResponseSchema } },
      description: "Authenticated user profile",
    },
    401: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Unauthorized",
    },
    403: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "OAuth Bearer required",
    },
  },
});

const organizationsRoute = createRoute({
  method: "get",
  path: "/v1/organizations",
  security: [{ bearerAuth: [] }],
  tags: ["User"],
  responses: {
    200: {
      content: {
        "application/json": { schema: OrganizationsResponseSchema },
      },
      description: "Organizations the user belongs to",
    },
    401: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Unauthorized",
    },
    403: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "OAuth Bearer required",
    },
  },
});

export function registerUserRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(meRoute, async (c) => {
    if (c.get("authContext").kind !== "oauth") {
      return errorResponse(c, 403, "FORBIDDEN", "OAuth Bearer required");
    }
    const { userId } = getOAuthContext(c);
    const profile = await getUserProfileForPublicApi(userId);
    if (!profile) {
      return errorResponse(c, 401, "UNAUTHORIZED", "User not found");
    }
    return c.json(profile, 200);
  });

  app.openapi(organizationsRoute, async (c) => {
    if (c.get("authContext").kind !== "oauth") {
      return errorResponse(c, 403, "FORBIDDEN", "OAuth Bearer required");
    }
    const { userId } = getOAuthContext(c);
    const organizations = await listOrganizationsForUser(userId);
    return c.json({ organizations }, 200);
  });
}
