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
  gcp: { project: "your-sandbox-project-id" },
  bootstrap: { budgetAmount: 50 },
} satisfies DeepPartialGcpEnvConfig;

export const config = composeEnvConfig(envBaseConfig, sandboxOverrides);
