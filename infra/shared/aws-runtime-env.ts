import {
  buildPublicUrlEnv,
  resolveLbHosts,
  resolveStaticHosts,
  type PublicUrlEnvName,
} from "./public-urls";

export type PublicUrlEnvKey = keyof ReturnType<typeof buildPublicUrlEnv>;

export interface AwsRuntimeEnvConfig {
  publicUrlOverrides?: Partial<Record<PublicUrlEnvKey, string>>;
  shared: Record<string, string>;
  byApp?: Partial<Record<string, Record<string, string>>>;
}

/** Safe loopback URLs when no apex domain is configured (local / bootstrap). */
const LOOPBACK_PUBLIC_URL_ENV: Record<PublicUrlEnvKey, string> = {
  BETTER_AUTH_URL: "http://127.0.0.1:4000",
  NEXT_PUBLIC_DASHBOARD_URL: "http://127.0.0.1:4000",
  NEXT_PUBLIC_API_URL: "http://127.0.0.1:4002",
  NEXT_PUBLIC_MCP_URL: "http://127.0.0.1:4003",
  NEXT_PUBLIC_WWW_URL: "http://127.0.0.1:4001",
};

/**
 * Flat per-env hostnames make staging and production siblings under one
 * registrable domain, so a parent-domain cookie would be sent to BOTH. Require
 * an exact match against this environment's own hostnames.
 *
 * A suffix test is deliberately NOT used: `.example.com` is a suffix of
 * `api-staging.example.com`, so a suffix rule would permit precisely the
 * cross-environment value this guard exists to reject.
 */
export function assertCookieDomainScoped(input: {
  cookieDomain: string | undefined;
  ownHosts: string[];
  env: string;
}): void {
  const raw = input.cookieDomain?.trim();
  if (!raw) return;
  const normalized = raw.startsWith(".") ? raw.slice(1) : raw;
  if (input.ownHosts.includes(normalized)) return;
  throw new Error(
    `WEB_AUTH_COOKIE_DOMAIN=${raw} is not one of the ${input.env} hostnames ` +
      `(${input.ownHosts.join(", ")}). A parent-domain cookie would be sent to ` +
      `every environment under the same registrable domain.`,
  );
}

/**
 * Merge order (later wins): infraVars → public URLs (derived or loopback) →
 * publicUrlOverrides → shared → byApp[appName].
 */
export function buildAppRuntimeEnvironmentVariables(input: {
  /** Organization root domain (e.g. `example.com`). Empty → loopback. */
  rootDomain: string;
  env: PublicUrlEnvName;
  runtimeEnv: AwsRuntimeEnvConfig;
  appName: string;
  infraVars: Record<string, string>;
}): Record<string, string> {
  const { rootDomain, env, runtimeEnv, appName, infraVars } = input;
  const root = rootDomain.trim();
  const publicUrls =
    root === "" ? LOOPBACK_PUBLIC_URL_ENV : buildPublicUrlEnv(root, env);

  // `publicUrlOverrides` is a Partial, so spreading it widens values to
  // `string | undefined`. Drop undefined entries rather than casting them
  // away: an env var explicitly set to undefined must not reach App Runner.
  const merged: Record<string, string> = Object.fromEntries(
    Object.entries({
      ...infraVars,
      ...publicUrls,
      ...runtimeEnv.publicUrlOverrides,
      ...runtimeEnv.shared,
      ...(runtimeEnv.byApp?.[appName] ?? {}),
    }).filter((entry): entry is [string, string] => entry[1] !== undefined),
  );

  if (root !== "") {
    assertCookieDomainScoped({
      cookieDomain: merged.WEB_AUTH_COOKIE_DOMAIN,
      ownHosts: [
        ...resolveLbHosts(root, env).map((h) => h.host),
        ...resolveStaticHosts(root, env).map((h) => h.host),
      ],
      env,
    });
  }

  return merged;
}
