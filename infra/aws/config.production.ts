import { envBaseConfig } from "./config.common";
import { composeEnvConfig } from "../shared/aws-env-config";
import { accountIdFromEnv } from "./env";
export const productionConfig = composeEnvConfig(envBaseConfig, {
  // accountId from AWS_PRODUCTION_ACCOUNT_ID (infra/.env.local). Deploy target is
  // decided by your credentials/profile (see GETTING_STARTED.md).
  aws: { accountId: accountIdFromEnv("production") },
  // Hybrid handles PHI: HIPAA (6y audit retention) layered on the SOC2 controls.
  complianceMode: "hipaa+soc2",
  network: { multiAzNat: true },
  database: { instanceClass: "db.t4g.medium", allocatedStorage: 50, multiAz: true },
  apps: { imageTag: "v0.1.0", minSize: 1, maxSize: 25, maxConcurrency: 80 },
});
export const config = productionConfig;
