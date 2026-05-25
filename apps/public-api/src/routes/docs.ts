import { apiReference } from "@scalar/hono-api-reference";
import type { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../lib/context";

export function registerDocs(app: OpenAPIHono<AppEnv>): void {
  // Register the API key security scheme via the OpenAPI registry
  app.openAPIRegistry.registerComponent("securitySchemes", "apiKey", {
    type: "apiKey",
    in: "header",
    name: "x-api-key",
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "bearerAuth", {
    type: "http",
    scheme: "bearer",
    bearerFormat: "JWT",
  });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Public API", version: "1.0.0" },
  });

  app.get("/docs", apiReference({ spec: { url: "/openapi.json" } }));
}
