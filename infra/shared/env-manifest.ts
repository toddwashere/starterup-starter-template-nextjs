import { QUEUE_PROFILES, type ProfileName } from "./queue-profiles";

export interface BuildEnvOptions {
  /** Base domain for the production deploy, e.g., "example.com". */
  baseDomain?: string;
  /** Override Redis URL (used by tests; default derived per profile). */
  redisUrl?: string;
  /** Override Postgres URL. */
  databaseUrl?: string;
}

const LOCAL_HOSTS = {
  dashboard: "http://localhost:4000",
  www: "http://localhost:4001",
  "public-api": "http://localhost:4002",
  "public-mcp": "http://localhost:4003",
} as const;

function publicUrls(
  profile: ProfileName,
  baseDomain?: string,
): Record<string, string> {
  if (profile === "local") {
    return {
      NEXT_PUBLIC_DASHBOARD_URL: LOCAL_HOSTS.dashboard,
      NEXT_PUBLIC_WWW_URL: LOCAL_HOSTS.www,
      NEXT_PUBLIC_API_URL: LOCAL_HOSTS["public-api"],
      NEXT_PUBLIC_MCP_URL: LOCAL_HOSTS["public-mcp"],
      NEXT_PUBLIC_BETTER_AUTH_URL: LOCAL_HOSTS.dashboard,
      BETTER_AUTH_URL: LOCAL_HOSTS.dashboard,
    };
  }
  if (!baseDomain) {
    throw new Error(`baseDomain is required for profile "${profile}"`);
  }
  const subdomain = (sub: string) => `https://${sub}.${baseDomain}`;
  return {
    NEXT_PUBLIC_DASHBOARD_URL: subdomain("app"),
    NEXT_PUBLIC_WWW_URL: `https://${baseDomain}`,
    NEXT_PUBLIC_API_URL: subdomain("api"),
    NEXT_PUBLIC_MCP_URL: subdomain("mcp"),
    NEXT_PUBLIC_BETTER_AUTH_URL: subdomain("app"),
    BETTER_AUTH_URL: subdomain("app"),
  };
}

function queueEnv(
  profile: ProfileName,
  redisUrl?: string,
): Record<string, string> {
  const { adapter } = QUEUE_PROFILES[profile];
  const env: Record<string, string> = {
    WORKER_QUEUE_ADAPTER: adapter,
    BULLMQ_QUEUE_NAME: "jobs",
  };
  if (adapter === "bullmq") {
    env.REDIS_URL =
      redisUrl ?? (profile === "local" ? "redis://localhost:6379" : "");
    // Empty REDIS_URL signals "supply via wizard / secrets" for managed PaaS.
  }
  return env;
}

export function buildEnv(
  profile: ProfileName,
  options: BuildEnvOptions = {},
): Record<string, string> {
  return {
    ...publicUrls(profile, options.baseDomain),
    ...queueEnv(profile, options.redisUrl),
    DATABASE_URL:
      options.databaseUrl ??
      (profile === "local"
        ? "postgresql://postgres:postgres@localhost:5432/starter_dev"
        : ""),
  };
}
