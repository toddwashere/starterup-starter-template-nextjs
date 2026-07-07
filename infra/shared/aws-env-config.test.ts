import { describe, it, expect } from "vitest";
import { composeEnvConfig, validateEnvConfig, type AwsEnvConfig } from "./aws-env-config";

const base: AwsEnvConfig = {
  schemaVersion: 1,
  aws: { region: "us-east-1", accountId: "" },
  complianceMode: "none",
  network: { vpcCidr: "10.30.0.0/16", multiAzNat: false },
  database: { instanceClass: "db.t4g.micro", allocatedStorage: 20, multiAz: false, engineVersion: "16" },
  apps: { imageTag: "latest", minSize: 1, maxSize: 5, maxConcurrency: 100 },
};

describe("aws-env-config", () => {
  it("layers overrides over base", () => {
    const prod = composeEnvConfig(base, { complianceMode: "soc2", database: { multiAz: true } });
    expect(prod.complianceMode).toBe("soc2");
    expect(prod.database.multiAz).toBe(true);
    expect(prod.database.instanceClass).toBe("db.t4g.micro");
  });

  it("flags missing region and account for compliant envs", () => {
    const r = validateEnvConfig({ ...base, aws: { region: "", accountId: "" }, complianceMode: "hipaa" }, "production");
    expect(r.ok).toBe(false);
    expect(r.critical.join(" ")).toMatch(/region/i);
  });
});
