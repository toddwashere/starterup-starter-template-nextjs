import { envBaseConfig } from "./config.common";
import { composeEnvConfig } from "../shared/aws-env-config";
import { accountIdFromEnv } from "./env";

// accountId comes from AWS_SANDBOX_ACCOUNT_ID (infra/.env.local) so a template
// repo never commits real ids. Your credentials still decide the deploy target
// (GETTING_STARTED.md "The golden rule"); accountId is only a sanity-check value.
export const config = composeEnvConfig(envBaseConfig, {
  aws: { accountId: accountIdFromEnv("sandbox") },
});
