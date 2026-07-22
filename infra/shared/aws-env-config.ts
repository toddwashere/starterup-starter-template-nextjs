import type { ComplianceMode } from "./compliance";
import type { AwsRuntimeEnvConfig } from "./aws-runtime-env";

export type AwsEnvName = "sandbox" | "staging" | "production";
export const SUPPORTED_SCHEMA_VERSION = 1;

export interface AwsNetworkConfig { vpcCidr: string; multiAzNat: boolean; }
/**
 * Public PgBouncer pooler settings. RDS Proxy cannot be public, so Vercel's
 * pooled path goes through an in-VPC PgBouncer fronted by a public NLB while RDS
 * itself stays private. `publicListener` exposes the NLB to the internet;
 * `poolSize` is PgBouncer's per-database backend pool size.
 */
export interface AwsPoolerConfig { enabled: boolean; publicListener: boolean; poolSize: number; }
export interface AwsDatabaseConfig {
  instanceClass: string; allocatedStorage: number; multiAz: boolean; engineVersion: string;
  pooler: AwsPoolerConfig;
}
export interface AwsAppsConfig {
  imageTag: string; minSize: number; maxSize: number; maxConcurrency: number;
}
/** Amazon Bedrock region + the model ids IAM policies are scoped to. */
export interface AwsAiConfig { bedrockRegion: string; bedrockModels: string[]; }
export interface AwsVercelOidcConfig { teamSlug: string; projectName: string; }
/** Cross-account access for Vercel-hosted apps via OIDC federation. */
export interface AwsAccessConfig { vercelOidc: AwsVercelOidcConfig; }
export interface AwsEnvConfig {
  schemaVersion: number;
  aws: { region: string; accountId: string };
  complianceMode: ComplianceMode;
  network: AwsNetworkConfig;
  database: AwsDatabaseConfig;
  apps: AwsAppsConfig;
  ai: AwsAiConfig;
  access: AwsAccessConfig;
  /** Non-secret runtime env injected into App Runner / workers (see aws-runtime-env). */
  runtimeEnv: AwsRuntimeEnvConfig;
}

export type DeepPartialAwsEnvConfig = {
  [K in keyof AwsEnvConfig]?: AwsEnvConfig[K] extends object
    ? { [P in keyof AwsEnvConfig[K]]?: AwsEnvConfig[K][P] } : AwsEnvConfig[K];
};

export function defineAwsEnvConfig(c: AwsEnvConfig): AwsEnvConfig { return c; }

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function deepMerge<T extends object>(user: Partial<T>, defaults: T): T {
  const out = structuredClone(defaults);
  for (const key of Object.keys(user) as (keyof T)[]) {
    const value = user[key];
    if (value === undefined) continue;
    const dv = out[key];
    out[key] = isPlainObject(value) && isPlainObject(dv)
      ? (deepMerge(value as Partial<object>, dv as object) as T[keyof T])
      : (value as T[keyof T]);
  }
  return out;
}
export function composeEnvConfig(base: AwsEnvConfig, ...overlays: DeepPartialAwsEnvConfig[]): AwsEnvConfig {
  return overlays.reduce<AwsEnvConfig>((acc, o) => deepMerge(o as Partial<AwsEnvConfig>, acc), base);
}

export interface ValidateResult { ok: boolean; critical: string[]; warnings: string[]; }
export function validateEnvConfig(config: AwsEnvConfig, _env: AwsEnvName): ValidateResult {
  const critical: string[] = []; const warnings: string[] = [];
  if (config.schemaVersion !== SUPPORTED_SCHEMA_VERSION) critical.push("Unsupported schemaVersion.");
  if (!config.aws.region?.trim()) critical.push("Missing aws.region.");
  if (config.complianceMode !== "none" && !config.aws.accountId?.trim())
    warnings.push("complianceMode set but aws.accountId empty (needed for some ARNs).");
  if (config.database.pooler.enabled && config.database.pooler.poolSize <= 0)
    critical.push("database.pooler.enabled but poolSize must be > 0.");
  if (config.ai.bedrockModels.length === 0)
    warnings.push("ai.bedrockModels empty — Bedrock IAM will grant no models.");
  if (config.database.pooler.publicListener && !config.access.vercelOidc.teamSlug.trim())
    warnings.push("Public pooler enabled but access.vercelOidc.teamSlug empty (needed to build the Vercel access role).");
  return { ok: critical.length === 0, critical, warnings };
}
