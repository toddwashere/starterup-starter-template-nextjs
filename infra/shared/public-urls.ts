/** Hostname prefix for each public app behind the HTTPS load balancer. */
export const LB_HOST_SUBDOMAINS = {
  dashboard: "app",
  "public-api": "api",
  "public-mcp": "mcp",
  www: "",
} as const;

export type LbRoutedApp = keyof typeof LB_HOST_SUBDOMAINS;

export interface DomainsConfig {
  /** Production apex domain (e.g. `example.com`). */
  base: string;
  /** Env prefix for staging → `staging.example.com`. */
  stagingPrefix: string;
  /** Env prefix for sandbox → `sandbox.example.com`. */
  sandboxPrefix: string;
}

/** Apex hostname for an environment (`example.com`, `staging.example.com`, …). */
export function resolveEnvApexDomain(
  domains: DomainsConfig,
  env: "sandbox" | "staging" | "production",
): string {
  const base = domains.base.trim();
  if (!base) return "";
  if (env === "production") return base;
  const prefix =
    env === "staging" ? domains.stagingPrefix.trim() : domains.sandboxPrefix.trim();
  if (!prefix) return base;
  return `${prefix}.${base}`;
}

/** LB host rules: `app.{apex}` → dashboard, apex → www, etc. */
export function resolveLbHosts(
  apexDomain: string,
): { host: string; app: LbRoutedApp }[] {
  const apex = apexDomain.trim();
  return (Object.entries(LB_HOST_SUBDOMAINS) as [LbRoutedApp, string][]).map(
    ([app, sub]) => ({
      host: sub ? `${sub}.${apex}` : apex,
      app,
    }),
  );
}

/** App-facing public URL env vars (matches `env-manifest` / Better Auth expectations). */
export function buildPublicUrlEnv(apexDomain: string): Record<string, string> {
  const apex = apexDomain.trim();
  return {
    NEXT_PUBLIC_DASHBOARD_URL: `https://app.${apex}`,
    NEXT_PUBLIC_WWW_URL: `https://${apex}`,
    NEXT_PUBLIC_API_URL: `https://api.${apex}`,
    NEXT_PUBLIC_MCP_URL: `https://mcp.${apex}`,
    NEXT_PUBLIC_BETTER_AUTH_URL: `https://app.${apex}`,
    BETTER_AUTH_URL: `https://app.${apex}`,
  };
}
