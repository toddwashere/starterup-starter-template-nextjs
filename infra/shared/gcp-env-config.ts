import type { ComplianceMode } from "./compliance";

export type GcpEnvName = "sandbox" | "staging" | "production";

export const GCP_ENV_NAMES: readonly GcpEnvName[] = [
  "sandbox",
  "staging",
  "production",
];
export const SUPPORTED_SCHEMA_VERSION = 1;

export interface BootstrapConfig {
  /** When true, Cloud SQL is private-only and a VPC connector is provisioned. */
  privateNetwork: boolean;
  /** VPC subnet CIDR for private networking (e.g. `10.10.0.0/24`). */
  vpcCidr: string;
  /** Monthly budget cap in USD. Requires `billingAccountId` to create the budget resource. */
  budgetAmount: number;
  /** GCP billing account ID. Leave empty to skip budget resource creation. */
  billingAccountId: string;
  /** GitHub repo for Actions WIF (e.g. `your-org/your-repo`). Leave empty to skip WIF binding. */
  githubRepo: string;
  /** Security contact email. Required when `complianceMode` is not `none`. */
  securityContactEmail: string;
}

export interface DatabaseConfig {
  /** Cloud SQL machine tier (e.g. `db-f1-micro` for sandbox). */
  tier: string;
  /** Postgres version (e.g. `POSTGRES_16`). */
  version: string;
  /** `ZONAL` or `REGIONAL` availability. */
  availability: string;
  /** Enable point-in-time recovery (recommended for production). */
  pointInTimeRecovery: boolean;
}

export interface StorageConfig {
  /** When true, buckets are destroyed on stack teardown (sandbox only). */
  forceDestroy: boolean;
}

export interface MessagingConfig {
  /** Provision Memorystore Redis (adds cost). Enable for Redis-backed queues. */
  enableRedis: boolean;
  /** Redis tier: `BASIC` or `STANDARD_HA`. */
  redisTier: string;
  /** Redis memory size in GB. */
  redisMemorySizeGb: number;
}

export interface AppsConfig {
  /** Container image tag deployed to Cloud Run. */
  imageTag: string;
  /** Provision HTTPS load balancer with managed cert (production). */
  enableHttpsLb: boolean;
  /** Enable Cloud Monitoring dashboards and alerts. */
  enableMonitoring: boolean;
  /** Public domain for the HTTPS LB. DNS stays at your registrar; point A records to LB IP. */
  lbDomain: string;
  /** Email address for monitoring alert notifications. */
  alertEmail: string;
  /** Enable VPC Service Controls perimeter. */
  vpcServiceControls: boolean;
  /** Numeric access policy ID when `vpcServiceControls` is true. */
  accessPolicyId: string;
}

export interface GcpProjectConfig {
  /** GCP project ID for this environment. */
  project: string;
  /** Default region for regional resources (e.g. `us-central1`). */
  region: string;
}

export interface GcpEnvConfig {
  /** Config schema version — must match `SUPPORTED_SCHEMA_VERSION`. */
  schemaVersion: number;
  gcp: GcpProjectConfig;
  /** Compliance bundle: `none`, `hipaa`, `soc2`, or `hipaa+soc2`. Propagated to all Pulumi layers. */
  complianceMode: ComplianceMode;
  bootstrap: BootstrapConfig;
  database: DatabaseConfig;
  storage: StorageConfig;
  messaging: MessagingConfig;
  apps: AppsConfig;
}

/** Recursive partial for env config overlays (common, staging deltas, tests). */
export type DeepPartialGcpEnvConfig = {
  [K in keyof GcpEnvConfig]?: GcpEnvConfig[K] extends object
    ? { [P in keyof GcpEnvConfig[K]]?: GcpEnvConfig[K][P] }
    : GcpEnvConfig[K];
};

export function envConfigPath(env: GcpEnvName): string {
  return `infra/gcp/config.${env}.ts`;
}

/** Type-check helper for env config files — export the full profile from each env file. */
export function defineGcpEnvConfig(config: GcpEnvConfig): GcpEnvConfig {
  return config;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function deepMerge<T extends object>(user: Partial<T>, defaults: T): T {
  const out = structuredClone(defaults);
  for (const key of Object.keys(user) as (keyof T)[]) {
    const value = user[key];
    if (value === undefined) continue;
    const defaultValue = out[key];
    if (isPlainObject(value) && isPlainObject(defaultValue)) {
      out[key] = deepMerge(
        value as Partial<object>,
        defaultValue as object,
      ) as T[keyof T];
    } else {
      out[key] = value as T[keyof T];
    }
  }
  return out;
}

/** Deep-merge: fill missing keys from defaults; never overwrite user-provided values. */
export function mergeEnvConfig(
  user: DeepPartialGcpEnvConfig,
  defaults: GcpEnvConfig,
): GcpEnvConfig {
  return deepMerge(user as Partial<GcpEnvConfig>, defaults);
}

/**
 * Layer partial configs onto a full base profile. Each overlay wins over the accumulated result.
 * Typical order: `composeEnvConfig(productionConfig, commonConfig, stagingOverrides)`.
 */
export function composeEnvConfig(
  base: GcpEnvConfig,
  ...overlays: DeepPartialGcpEnvConfig[]
): GcpEnvConfig {
  return overlays.reduce<GcpEnvConfig>(
    (acc, overlay) => mergeEnvConfig(overlay, acc),
    base,
  );
}

const COMPLIANCE_MODES: readonly ComplianceMode[] = ["none", "hipaa", "soc2", "hipaa+soc2"];

export interface ValidateResult {
  ok: boolean;
  critical: string[];
  warnings: string[];
}

export function validateEnvConfig(config: GcpEnvConfig, env: GcpEnvName): ValidateResult {
  const critical: string[] = [];
  const warnings: string[] = [];

  if (config.schemaVersion !== SUPPORTED_SCHEMA_VERSION) {
    critical.push(
      `Unsupported schemaVersion ${config.schemaVersion}; expected ${SUPPORTED_SCHEMA_VERSION}. Run the latest configure after upgrading the repo.`,
    );
  }

  if (!config.gcp.project?.trim()) {
    critical.push("Missing required gcp.project.");
  }
  if (!config.gcp.region?.trim()) {
    critical.push("Missing required gcp.region.");
  }

  if (!COMPLIANCE_MODES.includes(config.complianceMode)) {
    critical.push(`Invalid complianceMode "${config.complianceMode}".`);
  }

  if (config.apps.enableHttpsLb && !config.apps.lbDomain?.trim()) {
    critical.push("apps.enableHttpsLb is true but apps.lbDomain is empty.");
  }

  if (config.apps.enableMonitoring && !config.apps.alertEmail?.trim()) {
    critical.push("apps.enableMonitoring is true but apps.alertEmail is empty.");
  }

  if (config.bootstrap.budgetAmount > 0 && !config.bootstrap.billingAccountId?.trim()) {
    warnings.push(
      "bootstrap.budgetAmount is set but billingAccountId is empty — budget resource will not be created.",
    );
  }

  if (!config.bootstrap.githubRepo?.trim()) {
    warnings.push("bootstrap.githubRepo is empty — GitHub Actions WIF will not bind to a repo.");
  }

  if (config.complianceMode !== "none" && !config.bootstrap.securityContactEmail?.trim()) {
    warnings.push("complianceMode is enabled but bootstrap.securityContactEmail is empty.");
  }

  if (env === "sandbox" && config.apps.enableHttpsLb) {
    warnings.push("Sandbox has apps.enableHttpsLb enabled — this adds always-on LB cost.");
  }

  if (env === "sandbox" && config.database.tier !== "db-f1-micro") {
    warnings.push(
      `Sandbox uses database.tier "${config.database.tier}" — consider db-f1-micro for cost caps.`,
    );
  }

  return { ok: critical.length === 0, critical, warnings };
}

export type LayerName = "bootstrap" | "database" | "storage" | "messaging" | "secrets" | "apps";

const LAYER_PREFIX: Record<LayerName, string> = {
  bootstrap: "starter-gcp-bootstrap",
  database: "starter-gcp-database",
  storage: "starter-gcp-storage",
  messaging: "starter-gcp-messaging",
  secrets: "starter-gcp-secrets",
  apps: "starter-gcp-apps",
};

function stackRef(layer: LayerName, env: GcpEnvName): string {
  return `organization/starter-gcp-${layer}/${env}`;
}

function setIfNonEmpty(target: Record<string, string>, key: string, value: string | undefined): void {
  if (value !== undefined && value !== "") {
    target[key] = value;
  }
}

export function fanOutLayerConfig(
  layer: LayerName,
  env: GcpEnvName,
  config: GcpEnvConfig,
): Record<string, string> {
  const p = LAYER_PREFIX[layer];
  const out: Record<string, string> = {
    "gcp:project": config.gcp.project,
    "gcp:region": config.gcp.region,
  };

  switch (layer) {
    case "bootstrap":
      out[`${p}:privateNetwork`] = String(config.bootstrap.privateNetwork);
      out[`${p}:vpcCidr`] = config.bootstrap.vpcCidr;
      out[`${p}:complianceMode`] = config.complianceMode;
      out[`${p}:budgetAmount`] = String(config.bootstrap.budgetAmount);
      setIfNonEmpty(out, `${p}:billingAccountId`, config.bootstrap.billingAccountId);
      setIfNonEmpty(out, `${p}:githubRepo`, config.bootstrap.githubRepo);
      setIfNonEmpty(out, `${p}:securityContactEmail`, config.bootstrap.securityContactEmail);
      break;
    case "database":
      out[`${p}:bootstrapStackRef`] = stackRef("bootstrap", env);
      out[`${p}:dbTier`] = config.database.tier;
      out[`${p}:dbVersion`] = config.database.version;
      out[`${p}:dbAvailability`] = config.database.availability;
      out[`${p}:dbPointInTime`] = String(config.database.pointInTimeRecovery);
      out[`${p}:complianceMode`] = config.complianceMode;
      break;
    case "storage":
      out[`${p}:bootstrapStackRef`] = stackRef("bootstrap", env);
      out[`${p}:forceDestroy`] = String(config.storage.forceDestroy);
      out[`${p}:complianceMode`] = config.complianceMode;
      break;
    case "messaging":
      out[`${p}:bootstrapStackRef`] = stackRef("bootstrap", env);
      out[`${p}:enableRedis`] = String(config.messaging.enableRedis);
      out[`${p}:redisTier`] = config.messaging.redisTier;
      out[`${p}:redisMemorySizeGb`] = String(config.messaging.redisMemorySizeGb);
      out[`${p}:complianceMode`] = config.complianceMode;
      break;
    case "secrets":
      out[`${p}:bootstrapStackRef`] = stackRef("bootstrap", env);
      out[`${p}:databaseStackRef`] = stackRef("database", env);
      break;
    case "apps":
      out[`${p}:bootstrapStackRef`] = stackRef("bootstrap", env);
      out[`${p}:databaseStackRef`] = stackRef("database", env);
      out[`${p}:storageStackRef`] = stackRef("storage", env);
      out[`${p}:messagingStackRef`] = stackRef("messaging", env);
      out[`${p}:secretsStackRef`] = stackRef("secrets", env);
      out[`${p}:imageTag`] = config.apps.imageTag;
      out[`${p}:enableHttpsLb`] = String(config.apps.enableHttpsLb);
      out[`${p}:enableMonitoring`] = String(config.apps.enableMonitoring);
      out[`${p}:complianceMode`] = config.complianceMode;
      setIfNonEmpty(out, `${p}:lbDomain`, config.apps.lbDomain);
      setIfNonEmpty(out, `${p}:alertEmail`, config.apps.alertEmail);
      if (config.apps.vpcServiceControls) {
        out[`${p}:vpcServiceControls`] = "true";
      }
      setIfNonEmpty(out, `${p}:accessPolicyId`, config.apps.accessPolicyId);
      break;
  }

  return out;
}

export function renderPulumiStackYaml(entries: Record<string, string>): string {
  const lines = [
    "# Generated by pnpm infra:configure — edit infra/gcp/config.<env>.ts instead.",
    "config:",
  ];
  for (const [key, value] of Object.entries(entries).sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`  ${key}: "${value.replace(/"/g, '\\"')}"`);
  }
  return `${lines.join("\n")}\n`;
}
