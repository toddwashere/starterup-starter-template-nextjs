import { OpenAPIHono } from "@hono/zod-openapi";
// Direct `hono` import so Vercel's Hono framework detector recognizes this
// file as the deployable entrypoint (it requires a textual import from "hono").
import type {} from "hono";
import type { AppEnv } from "./lib/context";
import { createV1Router } from "./routes/v1";
import { registerDocs } from "./routes/docs";
import { registerEmailResendWebhookRoute } from "./routes/webhooks/email-resend";

export function createApp(): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  app.get("/health", (c) => c.json({ status: "ok" }));
  registerEmailResendWebhookRoute(app);
  app.route("/", createV1Router());
  registerDocs(app);
  return app;
}

export const app = createApp();

// Default export so Vercel's Hono builder can use this file as the serverless
// entrypoint. `OpenAPIHono` extends `Hono`, so this is a valid Hono app.
export default app;
