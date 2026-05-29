import type { Context } from "hono";

export type ErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "RATE_LIMITED"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INTERNAL_ERROR";

export function errorResponse<
  S extends 400 | 401 | 403 | 404 | 422 | 429 | 500,
>(c: Context, status: S, code: ErrorCode, message: string) {
  return c.json({ error: { code, message } }, status);
}
