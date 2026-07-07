import { productionConfig } from "./config.production";
import {
  composeEnvConfig,
  type DeepPartialGcpEnvConfig,
} from "../shared/gcp-env-config";

/**
 * Staging GCP environment — production profile with intentional cost cuts.
 *
 * Inherits prod topology (private network, prod DB tier, monitoring) but drops
 * REGIONAL HA, PITR, HTTPS LB, and SOC2.
 */
const stagingOverrides = {
  gcp: { project: "your-staging-project-id" },
  complianceMode: "none",
  bootstrap: { budgetAmount: 100 },
  database: {
    tier: "db-custom-1-3840",
    availability: "ZONAL",
    pointInTimeRecovery: false,
  },
  apps: {
    imageTag: "latest",
    enableHttpsLb: false,
  },
} satisfies DeepPartialGcpEnvConfig;

export const config = composeEnvConfig(productionConfig, stagingOverrides);
