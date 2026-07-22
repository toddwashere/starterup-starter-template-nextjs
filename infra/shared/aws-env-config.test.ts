import { describe, it, expect } from "vitest";
import { composeEnvConfig, validateEnvConfig, type AwsEnvConfig } from "./aws-env-config";
import { config as sandboxConfig } from "../aws/config.sandbox";
import { config as stagingConfig } from "../aws/config.staging";
import { config as productionConfig } from "../aws/config.production";

const base: AwsEnvConfig = {
  schemaVersion: 1,
  aws: { region: "us-east-2", accountId: "" },
  complianceMode: "none",
  network: { vpcCidr: "10.30.0.0/16", multiAzNat: false },
  database: {
    instanceClass: "db.t4g.micro",
    allocatedStorage: 20,
    multiAz: false,
    engineVersion: "16",
    pooler: { enabled: true, publicListener: true, poolSize: 25 },
  },
  apps: { imageTag: "latest", minSize: 1, maxSize: 5, maxConcurrency: 100 },
  ai: { bedrockRegion: "us-east-2", bedrockModels: ["anthropic.claude-sonnet-5"] },
  access: { vercelOidc: { teamSlug: "", projectName: "" } },
  runtimeEnv: { shared: {} },
};

describe("aws-env-config", () => {
  it("layers overrides over base", () => {
    const prod = composeEnvConfig(base, { complianceMode: "soc2", database: { multiAz: true } });
    expect(prod.complianceMode).toBe("soc2");
    expect(prod.database.multiAz).toBe(true);
    expect(prod.database.instanceClass).toBe("db.t4g.micro");
  });

  it("preserves nested pooler defaults when overriding a sibling database field", () => {
    const prod = composeEnvConfig(base, { database: { instanceClass: "db.t4g.large" } });
    expect(prod.database.instanceClass).toBe("db.t4g.large");
    expect(prod.database.pooler.enabled).toBe(true);
    expect(prod.database.pooler.poolSize).toBe(25);
  });

  it("replaces the bedrockModels array wholesale rather than merging", () => {
    const prod = composeEnvConfig(base, { ai: { bedrockModels: ["anthropic.claude-3-haiku-20240307-v1:0"] } });
    expect(prod.ai.bedrockModels).toEqual(["anthropic.claude-3-haiku-20240307-v1:0"]);
  });

  it("flags missing region and account for compliant envs", () => {
    const r = validateEnvConfig({ ...base, aws: { region: "", accountId: "" }, complianceMode: "hipaa" }, "production");
    expect(r.ok).toBe(false);
    expect(r.critical.join(" ")).toMatch(/region/i);
  });

  it("flags a pooler with a non-positive pool size as critical", () => {
    const r = validateEnvConfig(
      { ...base, database: { ...base.database, pooler: { enabled: true, publicListener: true, poolSize: 0 } } },
      "sandbox",
    );
    expect(r.ok).toBe(false);
    expect(r.critical.join(" ")).toMatch(/poolSize/i);
  });
});

describe("resolved AWS env configs", () => {
  it("exposes a public pooler in every environment (hybrid decision)", () => {
    for (const config of [sandboxConfig, stagingConfig, productionConfig]) {
      expect(config.database.pooler.enabled).toBe(true);
      expect(config.database.pooler.publicListener).toBe(true);
      expect(config.database.pooler.poolSize).toBeGreaterThan(0);
    }
  });

  it("carries Bedrock models and a Vercel-access block in every environment", () => {
    for (const config of [sandboxConfig, stagingConfig, productionConfig]) {
      expect(config.ai.bedrockModels.length).toBeGreaterThan(0);
      expect(config.access.vercelOidc).toBeDefined();
    }
  });
});
