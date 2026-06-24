import { envBaseConfig } from "./config.common";
import {
  composeEnvConfig,
  type DeepPartialGcpEnvConfig,
} from "../shared/gcp-env-config";

/**
 * Production GCP environment — source-of-truth profile for live traffic.
 *
 * All cost-bearing settings are declared here. Staging merges this profile plus
 * deltas in `config.staging.ts`. Sandbox uses `envBaseConfig` only.
 */
const productionOverrides = {
  gcp: { project: "your-prod-project-id" },
  complianceMode: "soc2",
  bootstrap: {
    privateNetwork: true,
    budgetAmount: 150,
  },
  database: {
    tier: "db-custom-2-7680",
    availability: "REGIONAL",
    pointInTimeRecovery: true,
  },
  storage: {
    forceDestroy: false,
  },
  messaging: {
    redisTier: "STANDARD_HA",
  },
  apps: {
    imageTag: "v0.1.0",
    enableHttpsLb: true,
    enableMonitoring: true,
    lbDomain: "example.com",
    alertEmail: "alerts@example.com",
  },
} satisfies DeepPartialGcpEnvConfig;

export const productionConfig = composeEnvConfig(
  envBaseConfig,
  productionOverrides,
);

export const config = productionConfig;
