import { envBaseConfig } from "./config.common";
import { composeEnvConfig } from "../shared/aws-env-config";
export const productionConfig = composeEnvConfig(envBaseConfig, {
  // Hybrid handles PHI: HIPAA (6y audit retention) layered on the SOC2 controls.
  complianceMode: "hipaa+soc2",
  network: { multiAzNat: true },
  database: { instanceClass: "db.t4g.medium", allocatedStorage: 50, multiAz: true },
  apps: { imageTag: "v0.1.0", minSize: 1, maxSize: 25, maxConcurrency: 80 },
});
export const config = productionConfig;
