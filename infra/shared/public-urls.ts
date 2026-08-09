/** Hostname prefix for each public app behind the HTTPS load balancer. */
export const LB_HOST_SUBDOMAINS = {
  dashboard: "dashboard",
  "public-api": "api",
  "public-mcp": "mcp",
  www: "",
} as const;

export type LbRoutedApp = keyof typeof LB_HOST_SUBDOMAINS;

/**
 * Hostname prefix for static hosts (CloudFront / S3), not App Runner LB.
 * Empty in the starter template; product forks may add entries.
 */
export const STATIC_HOST_SUBDOMAINS = {} as const;

export type StaticHostApp = keyof typeof STATIC_HOST_SUBDOMAINS;

export type PublicUrlEnvName = "sandbox" | "staging" | "production";

export interface DomainsConfig {
  /** Organization root domain at the registrar (e.g. `example.com`). */
  base: string;
  /** Env prefix for staging → `staging.example.com`. */
  stagingPrefix: string;
  /** Env prefix for sandbox → `sandbox.example.com`. */
  sandboxPrefix: string;
}

/**
 * Env-apex hostname for an environment.
 *
 * DEPRECATED for AWS. Retained only for the GCP HTTPS load balancer, which
 * needs a single apex domain (`infra/shared/gcp-env-config.ts`). AWS host
 * resolution goes through `resolveAppHost` — every environment puts its public
 * hosts directly under the root, so there is no env apex on that path.
 */
export function resolveEnvApexDomain(
  domains: DomainsConfig,
  env: PublicUrlEnvName,
): string {
  const base = domains.base.trim();
  if (!base) return "";
  if (env === "production") return base;
  const prefix =
    env === "staging" ? domains.stagingPrefix.trim() : domains.sandboxPrefix.trim();
  if (!prefix) return "";
  return `${prefix}.${base}`;
}

/**
 * Public hostname for one app label.
 *
 * - production → bare labels on the root (`api.example.com`); the empty label
 *   is the bare root itself (`example.com`).
 * - every other env → `{label}-{env}.{root}` (`api-staging.example.com`), so
 *   the host is a direct child of the root exactly like production. The empty
 *   label has no bare-root equivalent outside production, so it becomes `www`.
 */
export function resolveAppHost(
  label: string,
  env: PublicUrlEnvName,
  root: string,
): string {
  const base = root.trim();
  if (!base) return "";
  if (env === "production") return label ? `${label}.${base}` : base;
  return `${label || "www"}-${env}.${base}`;
}

/**
 * Public app hostnames that are proper subdomains of the root (not the bare
 * apex). One Route 53 zone is created per entry for NS delegation.
 *
 * `label` is the hostname minus the root — `api` in production,
 * `api-staging` in staging. It is the Pulumi resource-name suffix, so this
 * derivation must not change: production zones are `protect: true` and a
 * renamed resource would force replacement.
 */
export function resolveDelegatedAppHosts(
  root: string,
  env: PublicUrlEnvName,
): { host: string; app: LbRoutedApp; label: string }[] {
  const base = root.trim();
  if (!base) return [];
  return (Object.entries(LB_HOST_SUBDOMAINS) as [LbRoutedApp, string][])
    .map(([app, sub]) => ({ host: resolveAppHost(sub, env, base), app }))
    .filter((entry) => entry.host !== base)
    .map((entry) => ({
      ...entry,
      label: entry.host.slice(0, -(base.length + 1)),
    }));
}

/** Static SPA hosts. Starter template has none; product forks may add entries. */
export function resolveStaticHosts(
  root: string,
  env: PublicUrlEnvName,
): { host: string; app: StaticHostApp; label: string }[] {
  const base = root.trim();
  if (!base) return [];
  return (Object.entries(STATIC_HOST_SUBDOMAINS) as [StaticHostApp, string][]).map(
    ([app, sub]) => {
      const host = resolveAppHost(sub, env, base);
      return { host, app, label: host.slice(0, -(base.length + 1)) };
    },
  );
}

/** All NS-delegated public hosts: LB app subdomains followed by static hosts. */
export function resolveDelegatedPublicHosts(
  root: string,
  env: PublicUrlEnvName,
): { host: string; app: LbRoutedApp | StaticHostApp; label: string }[] {
  const base = root.trim();
  if (!base) return [];
  const staticHosts = (
    Object.entries(STATIC_HOST_SUBDOMAINS) as [StaticHostApp, string][]
  )
    .map(([app, sub]) => ({ host: resolveAppHost(sub, env, base), app }))
    .filter((entry) => entry.host !== base)
    .map((entry) => ({
      ...entry,
      label: entry.host.slice(0, -(base.length + 1)),
    }));
  return [...resolveDelegatedAppHosts(base, env), ...staticHosts];
}

/** LB host rules: `dashboard.{root}` → dashboard, `api-staging.{root}` → public-api, etc. */
export function resolveLbHosts(
  root: string,
  env: PublicUrlEnvName,
): { host: string; app: LbRoutedApp }[] {
  const base = root.trim();
  return (Object.entries(LB_HOST_SUBDOMAINS) as [LbRoutedApp, string][]).map(
    ([app, sub]) => ({ host: resolveAppHost(sub, env, base), app }),
  );
}

/** App-facing public URL env vars (matches `env-manifest` / Better Auth expectations). */
export function buildPublicUrlEnv(
  root: string,
  env: PublicUrlEnvName,
): Record<string, string> {
  const url = (label: string) => `https://${resolveAppHost(label, env, root)}`;
  const dashboard = url(LB_HOST_SUBDOMAINS.dashboard);
  return {
    NEXT_PUBLIC_DASHBOARD_URL: dashboard,
    NEXT_PUBLIC_WWW_URL: url(LB_HOST_SUBDOMAINS.www),
    NEXT_PUBLIC_API_URL: url(LB_HOST_SUBDOMAINS["public-api"]),
    NEXT_PUBLIC_MCP_URL: url(LB_HOST_SUBDOMAINS["public-mcp"]),
    NEXT_PUBLIC_BETTER_AUTH_URL: dashboard,
    BETTER_AUTH_URL: dashboard,
  };
}
