/**
 * Vercel serverless entrypoint for public-api.
 *
 * This file is the handler when public-api is deployed as a standalone Vercel
 * project using the Node.js runtime (not Next.js). The Hono `app.fetch`
 * function is a standard fetch-style handler that Vercel's Node.js Functions
 * can invoke directly via the default export.
 *
 * Vercel project settings:
 *   Framework:    Other
 *   Build output: (none — uses src directly via tsc/tsx)
 *   Root dir:     apps/public-api
 */
import { app } from "./app";

export const config = {
  runtime: "nodejs",
};

export default app.fetch;
