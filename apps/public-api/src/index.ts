import { OpenAPIHono } from "@hono/zod-openapi";
import { serve } from "@hono/node-server";
import type { AppEnv } from "./lib/context";
import { createV1Router } from "./routes/v1";
import { registerDocs } from "./routes/docs";
import { keys } from "../keys";

const app = new OpenAPIHono<AppEnv>();

app.route("/", createV1Router());
registerDocs(app);

const port = keys().PUBLIC_API_PORT;
serve({ fetch: app.fetch, port }, () => {
  console.log(`Public API running at http://localhost:${port}`);
  console.log(`Docs: http://localhost:${port}/docs`);
});
