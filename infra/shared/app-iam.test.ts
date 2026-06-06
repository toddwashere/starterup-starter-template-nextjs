import { describe, it, expect } from "vitest";
import { planAppIam } from "./app-iam";
import { APPS_BY_NAME } from "./apps.manifest";
import { secretsForApp } from "./secret-catalog";

describe("planAppIam", () => {
  it("grants cloudsql.client only to db apps", () => {
    expect(planAppIam(APPS_BY_NAME.dashboard).roles).toContain("roles/cloudsql.client");
    expect(planAppIam(APPS_BY_NAME.www).roles).not.toContain("roles/cloudsql.client");
  });

  it("grants pubsub publisher+subscriber to workers and needsPubsub apps", () => {
    const workers = planAppIam(APPS_BY_NAME.workers).roles;
    expect(workers).toContain("roles/pubsub.publisher");
    expect(workers).toContain("roles/pubsub.subscriber");
    const publicApi = planAppIam(APPS_BY_NAME["public-api"]).roles;
    expect(publicApi).toContain("roles/pubsub.publisher");
    expect(publicApi).toContain("roles/pubsub.subscriber");
    expect(planAppIam(APPS_BY_NAME.www).roles).not.toContain("roles/pubsub.subscriber");
  });

  it("grants storage.objectAdmin only to storage apps", () => {
    expect(planAppIam(APPS_BY_NAME.dashboard).roles).toContain("roles/storage.objectAdmin");
    expect(planAppIam(APPS_BY_NAME["public-mcp"]).roles).not.toContain("roles/storage.objectAdmin");
  });

  it("gives www no roles and no secret access", () => {
    const plan = planAppIam(APPS_BY_NAME.www);
    expect(plan.roles).toEqual([]);
    expect(plan.secretAccessorIds).toEqual([]);
  });

  it("secretAccessorIds matches secretsForApp", () => {
    const plan = planAppIam(APPS_BY_NAME.dashboard);
    expect(plan.secretAccessorIds.sort()).toEqual(
      secretsForApp("dashboard").map((s) => s.id).sort(),
    );
  });
});
