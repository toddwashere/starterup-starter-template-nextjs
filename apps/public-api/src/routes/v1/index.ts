import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../lib/context";
import { resolveAuth } from "../../middleware/resolve-auth";
import { requireApiKey } from "../../middleware/require-api-key";
import { orgContext } from "../../middleware/org-context";
import { registerAccountRoute } from "./account";
import { registerUserRoutes } from "./user";
import { registerOrgRoutes } from "./org";

export function createV1Router(): OpenAPIHono<AppEnv> {
  const v1 = new OpenAPIHono<AppEnv>();

  const user = new OpenAPIHono<AppEnv>();
  user.use("/*", resolveAuth);
  registerUserRoutes(user);

  const account = new OpenAPIHono<AppEnv>();
  account.use("/*", resolveAuth, requireApiKey);
  registerAccountRoute(account);

  const orgs = new OpenAPIHono<AppEnv>();
  orgs.use("/v1/orgs/:orgId/*", resolveAuth);
  orgs.use("/v1/orgs/:orgId/*", orgContext);
  registerOrgRoutes(orgs);

  v1.route("/", user);
  v1.route("/", account);
  v1.route("/", orgs);

  return v1;
}
