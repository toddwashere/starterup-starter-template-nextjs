import { defineAwsEnvConfig } from "../shared/aws-env-config";

export const envBaseConfig = defineAwsEnvConfig({
  schemaVersion: 1,
  aws: { region: "us-east-1", accountId: "" },
  complianceMode: "none",
  network: { vpcCidr: "10.30.0.0/16", multiAzNat: false },
  database: { instanceClass: "db.t4g.micro", allocatedStorage: 20, multiAz: false, engineVersion: "16" },
  apps: { imageTag: "latest", minSize: 1, maxSize: 5, maxConcurrency: 100 },
});
