import { OpenAPIHono } from "@hono/zod-openapi";
import type { AppEnv } from "../../lib/context";
import { resolveAuth } from "../../middleware/resolve-auth";
import { requireApiKey } from "../../middleware/require-api-key";
import { requireScope } from "../../middleware/require-scope";
import { orgContext } from "../../middleware/org-context";
import { registerAccountRoute } from "./account";
import { registerUserRoutes } from "./user";
import { registerOrgRoutes } from "./org";
import { registerAuthRoutes } from "./auth";

export function createV1Router(): OpenAPIHono<AppEnv> {
  const v1 = new OpenAPIHono<AppEnv>();

  // Scope auth middleware to the exact authenticated paths so it does not
  // leak onto sibling routers (e.g. the public /v1/auth/* routes) when these
  // sub-apps are all mounted at "/".
  const user = new OpenAPIHono<AppEnv>();
  user.use("/v1/me", resolveAuth, requireScope("account:read"));
  user.use("/v1/organizations", resolveAuth, requireScope("account:read"));
  registerUserRoutes(user);

  const account = new OpenAPIHono<AppEnv>();
  account.use("/v1/account", resolveAuth, requireApiKey);
  registerAccountRoute(account);

  const orgs = new OpenAPIHono<AppEnv>();
  orgs.use("/v1/orgs/:orgId/*", resolveAuth);
  orgs.use("/v1/orgs/:orgId/*", requireScope("account:read"));
  orgs.use("/v1/orgs/:orgId/*", orgContext);
  registerOrgRoutes(orgs);

  // Registration is public — no resolveAuth middleware.
  const auth = new OpenAPIHono<AppEnv>();
  registerAuthRoutes(auth);

  v1.route("/", user);
  v1.route("/", account);
  v1.route("/", orgs);
  v1.route("/", auth);

  return v1;
}
