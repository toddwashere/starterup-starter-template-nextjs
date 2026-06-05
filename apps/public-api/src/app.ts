import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "./lib/context";
import { createV1Router } from "./routes/v1";
import { registerDocs } from "./routes/docs";
import { registerEmailResendWebhookRoute } from "./routes/webhooks/email-resend";

export function createApp(): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  registerEmailResendWebhookRoute(app);
  app.route("/", createV1Router());
  registerDocs(app);
  return app;
}

export const app = createApp();
