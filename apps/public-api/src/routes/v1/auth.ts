import { createRoute, z, OpenAPIHono } from "@hono/zod-openapi";
import {
  registerUserForPublicApi,
  PublicApiRegisterError,
} from "@workspace/auth/public-api";
import type { AppEnv } from "../../lib/context";
import { errorResponse } from "../../lib/errors";
import { ErrorResponseSchema } from "../../lib/openapi-schemas";

const RegisterRequestSchema = z.object({
  name: z.string().min(1),
  email: z.string().email(),
  password: z.string().min(8),
});

const RegisterUserSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
});

const RegisterResponseSchema = z.object({
  user: RegisterUserSchema,
});

const registerRoute = createRoute({
  method: "post",
  path: "/v1/auth/register",
  tags: ["Auth"],
  request: {
    body: {
      content: {
        "application/json": { schema: RegisterRequestSchema },
      },
    },
  },
  responses: {
    201: {
      content: { "application/json": { schema: RegisterResponseSchema } },
      description: "Account created",
    },
    400: {
      content: { "application/json": { schema: ErrorResponseSchema } },
      description: "Validation error",
    },
  },
});

export function registerAuthRoutes(app: OpenAPIHono<AppEnv>): void {
  app.openapi(
    registerRoute,
    async (c) => {
      const { name, email, password } = c.req.valid("json");
      try {
        const user = await registerUserForPublicApi({ name, email, password });
        return c.json({ user }, 201);
      } catch (err) {
        if (err instanceof PublicApiRegisterError) {
          return errorResponse(c, 400, err.code, err.message);
        }
        throw err;
      }
    },
    (result, c) => {
      if (!result.success) {
        const message =
          result.error.issues[0]?.message ?? "Invalid request body";
        return errorResponse(c, 400, "VALIDATION_ERROR", message);
      }
    },
  );
}
