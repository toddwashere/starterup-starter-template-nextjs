import { defineAwsEnvConfig } from "../shared/aws-env-config";
import { vercelOidcFromEnv } from "./env";

export const envBaseConfig = defineAwsEnvConfig({
  schemaVersion: 1,
  aws: { region: "us-east-1", accountId: "" },
  complianceMode: "none",
  network: { vpcCidr: "10.30.0.0/16", multiAzNat: false },
  database: {
    instanceClass: "db.t4g.micro",
    allocatedStorage: 20,
    multiAz: false,
    engineVersion: "18",
    // Public PgBouncer in front of private RDS, in every env (hybrid decision).
    pooler: { enabled: true, publicListener: true, poolSize: 25 },
  },
  apps: { imageTag: "latest", minSize: 1, maxSize: 5, maxConcurrency: 100 },
  ai: {
    bedrockRegion: "us-east-1",
    bedrockModels: ["anthropic.claude-3-5-sonnet-20240620-v1:0"],
  },
  // teamSlug/projectName come from VERCEL_TEAM_SLUG / VERCEL_PROJECT_NAME
  // (infra/.env.local) so no deployment-specific identifiers live in git.
  access: { vercelOidc: vercelOidcFromEnv() },
});
