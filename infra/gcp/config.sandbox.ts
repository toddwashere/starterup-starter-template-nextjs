import { envBaseConfig } from "./config.common";
import {
  composeEnvConfig,
  type DeepPartialGcpEnvConfig,
} from "../shared/gcp-env-config";

/**
 * Sandbox GCP environment — cheap throwaway dev stacks.
 *
 * Builds on `envBaseConfig` with only project and budget overrides.
 */
const sandboxOverrides = {
  gcp: { project: "inthealth-test" },
  bootstrap: { budgetAmount: 20 },
} satisfies DeepPartialGcpEnvConfig;

export const config = composeEnvConfig(envBaseConfig, sandboxOverrides);
