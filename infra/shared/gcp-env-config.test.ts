import { describe, it, expect } from "vitest";
import { mergeEnvConfig, type GcpEnvConfig } from "./gcp-env-config";

const DEFAULTS: GcpEnvConfig = {
  schemaVersion: 1,
  gcp: { project: "default-proj", region: "us-central1" },
  complianceMode: "none",
  bootstrap: {
    privateNetwork: false,
    vpcCidr: "10.10.0.0/24",
    budgetAmount: 50,
    billingAccountId: "",
    githubRepo: "",
    securityContactEmail: "",
  },
  database: {
    tier: "db-f1-micro",
    version: "POSTGRES_16",
    availability: "ZONAL",
    pointInTimeRecovery: false,
  },
  storage: { forceDestroy: false },
  messaging: {
    enableRedis: false,
    redisTier: "BASIC",
    redisMemorySizeGb: 1,
  },
  apps: {
    imageTag: "latest",
    enableHttpsLb: false,
    enableMonitoring: false,
    lbDomain: "",
    alertEmail: "",
    vpcServiceControls: false,
    accessPolicyId: "",
  },
};

describe("mergeEnvConfig", () => {
  it("fills missing keys from defaults without overwriting user values", () => {
    const merged = mergeEnvConfig(
      { gcp: { project: "my-proj", region: "us-central1" } },
      DEFAULTS,
    );
    expect(merged.gcp.project).toBe("my-proj");
    expect(merged.database.tier).toBe("db-f1-micro");
    expect(merged.bootstrap.budgetAmount).toBe(50);
  });

  it("preserves user-set nested values", () => {
    const merged = mergeEnvConfig(
      {
        database: {
          tier: "db-custom-2-7680",
          version: "POSTGRES_16",
          availability: "REGIONAL",
          pointInTimeRecovery: true,
        },
      },
      DEFAULTS,
    );
    expect(merged.database.tier).toBe("db-custom-2-7680");
    expect(merged.database.pointInTimeRecovery).toBe(true);
    expect(merged.gcp.project).toBe("default-proj");
  });

  it("keeps default nested keys when user sets only part of an object", () => {
    const merged = mergeEnvConfig({ gcp: { project: "my-proj" } }, DEFAULTS);
    expect(merged.gcp.project).toBe("my-proj");
    expect(merged.gcp.region).toBe("us-central1");
  });
});
