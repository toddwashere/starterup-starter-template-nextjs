import { serve } from "@hono/node-server";
import { app } from "./app";
import { keys } from "../keys";

const port = keys().PUBLIC_API_PORT;
// Bind all interfaces so App Runner / container health checks can reach us.
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" }, () => {
  console.log(`Public API running at http://0.0.0.0:${port}`);
  console.log(`Docs: http://localhost:${port}/docs`);
});
