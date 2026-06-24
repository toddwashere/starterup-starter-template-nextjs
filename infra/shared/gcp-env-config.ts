import type { ComplianceMode } from "./compliance";

export type GcpEnvName = "sandbox" | "staging" | "production";

export const GCP_ENV_NAMES: readonly GcpEnvName[] = [
  "sandbox",
  "staging",
  "production",
];
export const SUPPORTED_SCHEMA_VERSION = 1;

export interface BootstrapConfig {
  privateNetwork: boolean;
  vpcCidr: string;
  budgetAmount: number;
  billingAccountId: string;
  githubRepo: string;
  securityContactEmail: string;
}

export interface DatabaseConfig {
  tier: string;
  version: string;
  availability: string;
  pointInTimeRecovery: boolean;
}

export interface StorageConfig {
  forceDestroy: boolean;
}

export interface MessagingConfig {
  enableRedis: boolean;
  redisTier: string;
  redisMemorySizeGb: number;
}

export interface AppsConfig {
  imageTag: string;
  enableHttpsLb: boolean;
  enableMonitoring: boolean;
  lbDomain: string;
  alertEmail: string;
  vpcServiceControls: boolean;
  accessPolicyId: string;
}

export interface GcpEnvConfig {
  schemaVersion: number;
  gcp: { project: string; region: string };
  complianceMode: ComplianceMode;
  bootstrap: BootstrapConfig;
  database: DatabaseConfig;
  storage: StorageConfig;
  messaging: MessagingConfig;
  apps: AppsConfig;
}

export function envConfigPath(env: GcpEnvName): string {
  return `infra/gcp/config.${env}.yaml`;
}

export function envExamplePath(env: GcpEnvName): string {
  return `infra/gcp/config.${env}.example.yaml`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T extends Record<string, unknown>>(
  user: Partial<T>,
  defaults: T,
): T {
  const out = structuredClone(defaults);
  for (const [key, value] of Object.entries(user)) {
    if (value === undefined) continue;
    const defaultValue = out[key as keyof T];
    if (isPlainObject(value) && isPlainObject(defaultValue)) {
      (out as Record<string, unknown>)[key] = deepMerge(
        value as Record<string, unknown>,
        defaultValue as Record<string, unknown>,
      );
    } else {
      (out as Record<string, unknown>)[key] = value;
    }
  }
  return out;
}

/** Deep-merge: fill missing keys from defaults; never overwrite user-provided values. */
export function mergeEnvConfig(
  user: Partial<GcpEnvConfig>,
  defaults: GcpEnvConfig,
): GcpEnvConfig {
  return deepMerge(user, defaults);
}
