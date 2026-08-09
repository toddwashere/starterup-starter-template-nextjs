import {
  composeEnvConfig,
  defineGcpEnvConfig,
  type DeepPartialGcpEnvConfig,
} from "../shared/gcp-env-config";

/**
 * Shared invariants — structural defaults that should not drift across environments.
 *
 * No cost-bearing settings here; those live in `config.production.ts` (and staging
 * inherits via `productionConfig` unless explicitly overridden).
 */
export const commonConfig = {
  schemaVersion: 1,
  gcp: { region: "us-central1" },
  domains: {
    base: "example.com",
    stagingPrefix: "staging",
    sandboxPrefix: "sandbox",
  },
  database: { version: "POSTGRES_16" },
  bootstrap: {
    vpcCidr: "10.10.0.0/24",
    billingAccountId: "01168C-A16561-C2E826",
    githubRepo: "https://github.com/toddwashere/starterup-starter-template-nextjs",
    securityContactEmail: "security@example.com",
  },
  messaging: {
    enableRedis: false,
    redisMemorySizeGb: 1,
  },
  apps: {
    vpcServiceControls: false,
    accessPolicyId: "",
  },
} satisfies DeepPartialGcpEnvConfig;

/** Cheap neutral baseline — sandbox builds from here; production/staging opt into spend. */
const envBase = defineGcpEnvConfig({
  schemaVersion: 1,
  gcp: { project: "", region: "us-central1" },
  domains: {
    base: "",
    stagingPrefix: "staging",
    sandboxPrefix: "sandbox",
  },
  complianceMode: "none",
  bootstrap: {
    privateNetwork: true,
    vpcCidr: "10.10.0.0/24",
    budgetAmount: 0,
    billingAccountId: "",
    githubRepo: "",
    securityContactEmail: "",
  },
  database: {
    tier: "db-f1-micro",
    version: "POSTGRES_16",
    availability: "ZONAL",
    pointInTimeRecovery: false,
  },
  storage: {
    forceDestroy: true,
  },
  messaging: {
    enableRedis: false,
    redisTier: "BASIC",
    redisMemorySizeGb: 1,
  },
  apps: {
    imageTag: "latest",
    enableHttpsLb: false,
    enableMonitoring: false,
    alertEmail: "",
    vpcServiceControls: false,
    accessPolicyId: "",
  },
});

export const envBaseConfig = composeEnvConfig(envBase, commonConfig);
