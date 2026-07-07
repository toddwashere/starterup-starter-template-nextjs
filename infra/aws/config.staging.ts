import { productionConfig } from "./config.production";
import { composeEnvConfig } from "../shared/aws-env-config";
export const config = composeEnvConfig(productionConfig, {
  complianceMode: "soc2",
  network: { multiAzNat: false },
  database: { instanceClass: "db.t4g.small", multiAz: false },
});
