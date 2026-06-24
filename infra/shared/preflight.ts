export interface EnvConfigCheck {
  critical: string[];
  warnings: string[];
}

export interface PreflightInput {
  authenticated: boolean;
  billingLinked: boolean;
  projectExists: boolean;
  stateBucketReachable: boolean;
  config: Record<string, string | undefined>;
  requiredKeys: readonly string[];
  /** From validateEnvConfig — critical issues block deploy. */
  envConfig?: EnvConfigCheck;
}

export interface PreflightResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
}

export function runPreflight(input: PreflightInput): PreflightResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!input.authenticated) {
    errors.push("Not authenticated to GCP. Run `gcloud auth application-default login`.");
  }
  if (!input.billingLinked) {
    errors.push("Billing is not linked to the target project. Link it in the GCP console.");
  }
  if (!input.projectExists) {
    errors.push("Target GCP project does not exist. Create it before deploying.");
  }
  if (!input.stateBucketReachable) {
    errors.push("Pulumi state bucket is unreachable. Run the state bucket pre-step.");
  }
  for (const key of input.requiredKeys) {
    if (!input.config[key]) {
      errors.push(`Missing required Pulumi config key: ${key}`);
    }
  }

  if (input.envConfig) {
    for (const issue of input.envConfig.critical) {
      errors.push(`Env config: ${issue}`);
    }
    warnings.push(...input.envConfig.warnings);
  }

  return { ok: errors.length === 0, errors, warnings };
}
