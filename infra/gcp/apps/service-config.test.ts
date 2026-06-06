import { describe, it, expect } from "vitest";
import { buildAppEnv, appRoles, publicInvokerApps, type EnvContext } from "./service-config";
import { APPS_BY_NAME } from "../../shared/apps.manifest";
import { planAppIam } from "../../shared/app-iam";

const ctx: EnvContext = {
  projectId: "test-project",
  pubsubTopic: "jobs-sandbox",
  redisHost: "",
  redisPort: 0,
  uploadsBucket: "test-project-uploads-sandbox",
};

function envNames(app: keyof typeof APPS_BY_NAME, c: EnvContext = ctx): string[] {
  return buildAppEnv(APPS_BY_NAME[app], c).map((e) => e.name);
}

describe("buildAppEnv", () => {
  it("www gets no DATABASE_URL and no secret env vars", () => {
    const names = envNames("www");
    expect(names).not.toContain("DATABASE_URL");
    expect(names).not.toContain("BETTER_AUTH_SECRET");
    expect(names).toContain("PORT");
  });

  it("dashboard gets DATABASE_URL and BETTER_AUTH_SECRET", () => {
    const names = envNames("dashboard");
    expect(names).toContain("DATABASE_URL");
    expect(names).toContain("BETTER_AUTH_SECRET");
  });

  it("workers get pubsub env and adapter", () => {
    const names = envNames("workers");
    expect(names).toContain("PUBSUB_TOPIC");
    expect(names).toContain("GCP_PROJECT_ID");
    expect(names).toContain("WORKER_QUEUE_ADAPTER");
  });

  it("REDIS_URL only when usesRedis and redisHost present", () => {
    expect(envNames("dashboard")).not.toContain("REDIS_URL");
    const withRedis = envNames("dashboard", { ...ctx, redisHost: "10.0.0.3", redisPort: 6379 });
    expect(withRedis).toContain("REDIS_URL");
  });

  it("GCS_UPLOADS_BUCKET only for needsStorage apps with a bucket", () => {
    expect(envNames("dashboard")).toContain("GCS_UPLOADS_BUCKET");
    expect(envNames("www")).not.toContain("GCS_UPLOADS_BUCKET");
    expect(envNames("public-mcp")).not.toContain("GCS_UPLOADS_BUCKET");
  });
});

describe("appRoles", () => {
  it("matches planAppIam roles", () => {
    expect(appRoles(APPS_BY_NAME.dashboard)).toEqual(planAppIam(APPS_BY_NAME.dashboard).roles);
  });
});

describe("publicInvokerApps", () => {
  it("returns public apps only, never workers", () => {
    const names = publicInvokerApps().map((a) => a.name);
    expect(names).toContain("dashboard");
    expect(names).toContain("www");
    expect(names).not.toContain("workers");
  });
});
