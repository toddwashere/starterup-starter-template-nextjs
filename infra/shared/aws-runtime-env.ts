import { buildPublicUrlEnv } from "./public-urls";

export type PublicUrlEnvKey = keyof ReturnType<typeof buildPublicUrlEnv>;

export interface AwsRuntimeEnvConfig {
  publicUrlOverrides?: Partial<Record<PublicUrlEnvKey, string>>;
  shared: Record<string, string>;
  byApp?: Partial<Record<string, Record<string, string>>>;
}

/** Safe loopback URLs when no apex domain is configured (local / bootstrap). */
const LOOPBACK_PUBLIC_URL_ENV: Record<PublicUrlEnvKey, string> = {
  BETTER_AUTH_URL: "http://127.0.0.1:4000",
  NEXT_PUBLIC_BETTER_AUTH_URL: "http://127.0.0.1:4000",
  NEXT_PUBLIC_DASHBOARD_URL: "http://127.0.0.1:4000",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:4002",
  NEXT_PUBLIC_MCP_URL: "http://127.0.0.1:4003",
  NEXT_PUBLIC_WWW_URL: "http://127.0.0.1:4001",
};

/**
 * Merge order (later wins): infraVars → public URLs (derived or loopback) →
 * publicUrlOverrides → shared → byApp[appName].
 */
export function buildAppRuntimeEnvironmentVariables(input: {
  /** Env apex (e.g. `staging.example.com` or `example.com`). */
  apexDomain: string;
  runtimeEnv: AwsRuntimeEnvConfig;
  appName: string;
  infraVars: Record<string, string>;
}): Record<string, string> {
  const { apexDomain, runtimeEnv, appName, infraVars } = input;
  const publicUrls =
    apexDomain.trim() === ""
      ? LOOPBACK_PUBLIC_URL_ENV
      : buildPublicUrlEnv(apexDomain);

  const overrides = Object.fromEntries(
    Object.entries(runtimeEnv.publicUrlOverrides ?? {}).filter(
      (entry): entry is [string, string] => entry[1] !== undefined,
    ),
  );

  return {
    ...infraVars,
    ...publicUrls,
    ...overrides,
    ...runtimeEnv.shared,
    ...(runtimeEnv.byApp?.[appName] ?? {}),
  };
}
