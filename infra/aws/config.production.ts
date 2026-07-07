import { envBaseConfig } from "./config.common";
import { composeEnvConfig } from "../shared/aws-env-config";
export const productionConfig = composeEnvConfig(envBaseConfig, {
  complianceMode: "soc2",
  network: { multiAzNat: true },
  database: { instanceClass: "db.t4g.medium", allocatedStorage: 50, multiAz: true },
  apps: { imageTag: "v0.1.0", minSize: 1, maxSize: 25, maxConcurrency: 80 },
});
export const config = productionConfig;
