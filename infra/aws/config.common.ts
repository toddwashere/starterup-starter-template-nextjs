import { defineAwsEnvConfig } from "../shared/aws-env-config";

export const envBaseConfig = defineAwsEnvConfig({
  schemaVersion: 1,
  aws: { region: "us-east-1", accountId: "" },
  complianceMode: "none",
  network: { vpcCidr: "10.30.0.0/16", multiAzNat: false },
  database: {
    instanceClass: "db.t4g.micro",
    allocatedStorage: 20,
    multiAz: false,
    engineVersion: "16",
    // Public PgBouncer in front of private RDS, in every env (hybrid decision).
    pooler: { enabled: true, publicListener: true, poolSize: 25 },
  },
  apps: { imageTag: "latest", minSize: 1, maxSize: 5, maxConcurrency: 100 },
  ai: {
    bedrockRegion: "us-east-1",
    bedrockModels: ["anthropic.claude-3-5-sonnet-20240620-v1:0"],
  },
  // Populate teamSlug/projectName per deployment to build the Vercel OIDC role.
  access: { vercelOidc: { teamSlug: "", projectName: "" } },
});
