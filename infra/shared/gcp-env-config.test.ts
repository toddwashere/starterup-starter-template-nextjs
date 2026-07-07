import { describe, it, expect } from "vitest";
import {
  composeEnvConfig,
  defineGcpEnvConfig,
  fanOutLayerConfig,
  mergeEnvConfig,
  renderPulumiStackYaml,
  validateEnvConfig,
  type GcpEnvConfig,
} from "./gcp-env-config";
import { envBaseConfig as sandbox } from "../gcp/config.common";
import { config as staging } from "../gcp/config.staging";
import { config as production } from "../gcp/config.production";

describe("single-topology config", () => {
  it("enables privateNetwork in every environment", () => {
    expect(sandbox.bootstrap.privateNetwork).toBe(true);
    expect(staging.bootstrap.privateNetwork).toBe(true);
    expect(production.bootstrap.privateNetwork).toBe(true);
  });

  it("uses a smaller staging database tier", () => {
    expect(staging.database.tier).toBe("db-custom-1-3840");
    expect(staging.database.availability).toBe("ZONAL");
  });
});

const SANDBOX_FIXTURE: GcpEnvConfig = defineGcpEnvConfig({
  schemaVersion: 1,
  gcp: { project: "default-proj", region: "us-central1" },
  domains: { base: "example.com", stagingPrefix: "staging", sandboxPrefix: "sandbox" },
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
    alertEmail: "",
    vpcServiceControls: false,
    accessPolicyId: "",
  },
});

describe("defineGcpEnvConfig", () => {
  it("returns the config unchanged (type-check helper)", () => {
    expect(defineGcpEnvConfig(SANDBOX_FIXTURE)).toBe(SANDBOX_FIXTURE);
  });
});

describe("mergeEnvConfig", () => {
  it("fills missing keys from defaults without overwriting user values", () => {
    const merged = mergeEnvConfig(
      { gcp: { project: "my-proj", region: "us-central1" } },
      SANDBOX_FIXTURE,
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
      SANDBOX_FIXTURE,
    );
    expect(merged.database.tier).toBe("db-custom-2-7680");
    expect(merged.database.pointInTimeRecovery).toBe(true);
    expect(merged.gcp.project).toBe("default-proj");
  });

  it("keeps default nested keys when user sets only part of an object", () => {
    const merged = mergeEnvConfig({ gcp: { project: "my-proj" } }, SANDBOX_FIXTURE);
    expect(merged.gcp.project).toBe("my-proj");
    expect(merged.gcp.region).toBe("us-central1");
  });
});

describe("composeEnvConfig", () => {
  it("applies overlays in order so later layers win", () => {
    const base = defineGcpEnvConfig({
      ...SANDBOX_FIXTURE,
      database: { ...SANDBOX_FIXTURE.database, tier: "db-custom-2-7680" },
    });
    const composed = composeEnvConfig(
      base,
      { database: { version: "POSTGRES_16" } },
      { database: { tier: "db-f1-micro" } },
    );
    expect(composed.database.tier).toBe("db-f1-micro");
    expect(composed.database.version).toBe("POSTGRES_16");
    expect(composed.gcp.project).toBe("default-proj");
  });
});

describe("validateEnvConfig", () => {
  it("fails critical when gcp.project is empty", () => {
    const cfg = mergeEnvConfig({ gcp: { project: "", region: "us-central1" } }, SANDBOX_FIXTURE);
    const result = validateEnvConfig(cfg, "sandbox");
    expect(result.ok).toBe(false);
    expect(result.critical.some((e) => e.includes("gcp.project"))).toBe(true);
  });

  it("fails critical when enableHttpsLb is true without domains.base", () => {
    const cfg = mergeEnvConfig(
      {
        gcp: { project: "acme", region: "us-central1" },
        domains: { base: "", stagingPrefix: "staging", sandboxPrefix: "sandbox" },
        apps: { ...SANDBOX_FIXTURE.apps, enableHttpsLb: true },
      },
      SANDBOX_FIXTURE,
    );
    const result = validateEnvConfig(cfg, "production");
    expect(result.ok).toBe(false);
    expect(result.critical.some((e) => e.includes("domains.base"))).toBe(true);
  });

  it("warns but passes when githubRepo is empty", () => {
    const cfg = mergeEnvConfig({ gcp: { project: "acme", region: "us-central1" } }, SANDBOX_FIXTURE);
    const result = validateEnvConfig(cfg, "sandbox");
    expect(result.ok).toBe(true);
    expect(result.warnings.some((w) => w.includes("githubRepo"))).toBe(true);
  });

  it("fails on unsupported schemaVersion", () => {
    const cfg = mergeEnvConfig(
      { schemaVersion: 99, gcp: { project: "acme", region: "us-central1" } },
      SANDBOX_FIXTURE,
    );
    const result = validateEnvConfig(cfg, "sandbox");
    expect(result.ok).toBe(false);
    expect(result.critical.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("warns on sandbox cost guardrails when enableHttpsLb is true", () => {
    const cfg = mergeEnvConfig(
      {
        gcp: { project: "acme", region: "us-central1" },
        apps: { ...SANDBOX_FIXTURE.apps, enableHttpsLb: true },
      },
      SANDBOX_FIXTURE,
    );
    const result = validateEnvConfig(cfg, "sandbox");
    expect(result.warnings.some((w) => w.toLowerCase().includes("sandbox"))).toBe(true);
  });
});

describe("fanOutLayerConfig", () => {
  const cfg = mergeEnvConfig(
    { gcp: { project: "acme-sandbox", region: "us-central1" }, complianceMode: "none" },
    SANDBOX_FIXTURE,
  );

  it("maps bootstrap keys", () => {
    const out = fanOutLayerConfig("bootstrap", "sandbox", cfg);
    expect(out["gcp:project"]).toBe("acme-sandbox");
    expect(out["starter-gcp-bootstrap:privateNetwork"]).toBe("false");
    expect(out["starter-gcp-bootstrap:complianceMode"]).toBe("none");
  });

  it("maps database stack ref", () => {
    const out = fanOutLayerConfig("database", "sandbox", cfg);
    expect(out["starter-gcp-database:bootstrapStackRef"]).toBe(
      "organization/starter-gcp-bootstrap/sandbox",
    );
    expect(out["starter-gcp-database:dbTier"]).toBe("db-f1-micro");
  });

  it("propagates complianceMode to apps layer", () => {
    const prod = mergeEnvConfig(
      { gcp: { project: "acme-prod", region: "us-central1" }, complianceMode: "soc2" },
      SANDBOX_FIXTURE,
    );
    const out = fanOutLayerConfig("apps", "production", prod);
    expect(out["starter-gcp-apps:complianceMode"]).toBe("soc2");
    expect(out["starter-gcp-apps:secretsStackRef"]).toBe(
      "organization/starter-gcp-secrets/production",
    );
  });

  it("omits empty optional bootstrap strings", () => {
    const out = fanOutLayerConfig("bootstrap", "sandbox", cfg);
    expect(out["starter-gcp-bootstrap:billingAccountId"]).toBeUndefined();
    expect(out["starter-gcp-bootstrap:githubRepo"]).toBeUndefined();
  });

  it("fans out env-specific apex domains to apps lbDomain", () => {
    const outProd = fanOutLayerConfig("apps", "production", cfg);
    expect(outProd["starter-gcp-apps:lbDomain"]).toBe("example.com");

    const outStaging = fanOutLayerConfig("apps", "staging", cfg);
    expect(outStaging["starter-gcp-apps:lbDomain"]).toBe("staging.example.com");

    const outSandbox = fanOutLayerConfig("apps", "sandbox", cfg);
    expect(outSandbox["starter-gcp-apps:lbDomain"]).toBe("sandbox.example.com");
  });
});

describe("renderPulumiStackYaml", () => {
  it("renders a config block with quoted values", () => {
    const yaml = renderPulumiStackYaml({ "gcp:project": "acme", "gcp:region": "us-central1" });
    expect(yaml).toContain('gcp:project: "acme"');
    expect(yaml).toContain("config:");
  });
});
