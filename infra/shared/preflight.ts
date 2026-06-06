export interface PreflightInput {
  authenticated: boolean;
  billingLinked: boolean;
  projectExists: boolean;
  stateBucketReachable: boolean;
  config: Record<string, string | undefined>;
  requiredKeys: readonly string[];
}

export interface PreflightResult {
  ok: boolean;
  errors: string[];
}

export function runPreflight(input: PreflightInput): PreflightResult {
  const errors: string[] = [];
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
  return { ok: errors.length === 0, errors };
}
