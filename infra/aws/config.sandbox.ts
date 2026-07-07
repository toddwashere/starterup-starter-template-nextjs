import { envBaseConfig } from "./config.common";
import { composeEnvConfig } from "../shared/aws-env-config";
export const config = composeEnvConfig(envBaseConfig, { aws: { accountId: "" } });
