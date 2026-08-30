import { z } from "@hono/zod-openapi";

/**
 * Reusable error response schema matching the runtime shape produced by
 * `errorResponse` in `./errors.ts`: `{ error: { code, message } }`.
 *
 * The `.openapi("ErrorResponse")` ref name registers this as a named
 * component so it appears under `components.schemas.ErrorResponse` in the
 * generated OpenAPI document (good for mobile client generators).
 */
export const ErrorResponseSchema = z
  .object({
    error: z.object({
      code: z.enum([
        "UNAUTHORIZED",
        "FORBIDDEN",
        "RATE_LIMITED",
        "NOT_FOUND",
        "VALIDATION_ERROR",
        "INSUFFICIENT_CREDITS",
        "INTERNAL_ERROR",
      ]),
      message: z.string(),
    }),
  })
  .openapi("ErrorResponse");
