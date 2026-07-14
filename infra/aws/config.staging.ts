import { productionConfig } from "./config.production";
import { composeEnvConfig } from "../shared/aws-env-config";
import { accountIdFromEnv } from "./env";
export const config = composeEnvConfig(productionConfig, {
  // accountId from AWS_STAGING_ACCOUNT_ID (infra/.env.local). Deploy target is
  // decided by your credentials/profile (see GETTING_STARTED.md).
  aws: { accountId: accountIdFromEnv("staging") },
  complianceMode: "soc2",
  network: { multiAzNat: false },
  database: { instanceClass: "db.t4g.small", multiAz: false },
});
