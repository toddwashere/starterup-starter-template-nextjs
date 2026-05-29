import { serve } from "@hono/node-server";
import { app } from "./app";
import { keys } from "../keys";

const port = keys().PUBLIC_API_PORT;
serve({ fetch: app.fetch, port }, () => {
  console.log(`Public API running at http://localhost:${port}`);
  console.log(`Docs: http://localhost:${port}/docs`);
});
