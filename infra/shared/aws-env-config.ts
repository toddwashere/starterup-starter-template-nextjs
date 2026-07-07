import type { ComplianceMode } from "./compliance";

export type AwsEnvName = "sandbox" | "staging" | "production";
export const SUPPORTED_SCHEMA_VERSION = 1;

export interface AwsNetworkConfig { vpcCidr: string; multiAzNat: boolean; }
export interface AwsDatabaseConfig {
  instanceClass: string; allocatedStorage: number; multiAz: boolean; engineVersion: string;
}
export interface AwsAppsConfig {
  imageTag: string; minSize: number; maxSize: number; maxConcurrency: number;
}
export interface AwsEnvConfig {
  schemaVersion: number;
  aws: { region: string; accountId: string };
  complianceMode: ComplianceMode;
  network: AwsNetworkConfig;
  database: AwsDatabaseConfig;
  apps: AwsAppsConfig;
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
  return { ok: critical.length === 0, critical, warnings };
}
