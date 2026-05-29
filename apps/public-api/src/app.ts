import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "./lib/context";
import { createV1Router } from "./routes/v1";
import { registerDocs } from "./routes/docs";

export function createApp(): OpenAPIHono<AppEnv> {
  const app = new OpenAPIHono<AppEnv>();
  app.route("/", createV1Router());
  registerDocs(app);
  return app;
}

export const app = createApp();
