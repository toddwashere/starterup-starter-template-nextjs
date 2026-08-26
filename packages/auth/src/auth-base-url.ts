const LOCAL_DASHBOARD_URL = "http://localhost:4000";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1", "[::1]"]);

function stripTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function httpsOrigin(host: string | undefined): string | undefined {
  const trimmed = host?.trim();
  if (!trimmed) return undefined;
  return `https://${stripTrailingSlash(trimmed)}`;
}

export function isLoopbackUrl(value: string): boolean {
  try {
    return LOOPBACK_HOSTS.has(new URL(value).hostname);
  } catch {
    return false;
  }
}

/**
 * Public origin of the dashboard (which hosts Better Auth).
 *
 * `NEXT_PUBLIC_DASHBOARD_URL` is the source of truth. Vercel provides a
 * production/preview host when that var was never set — which would otherwise
 * silently bake `localhost:4000` into the client bundle.
 */
export function fallbackAuthUrl(): string {
  const dashboard = process.env.NEXT_PUBLIC_DASHBOARD_URL?.trim();
  if (dashboard) return stripTrailingSlash(dashboard);
  const production = httpsOrigin(process.env.VERCEL_PROJECT_PRODUCTION_URL);
  if (production) return production;
  const vercel = httpsOrigin(process.env.VERCEL_URL);
  if (vercel) return vercel;
  return LOCAL_DASHBOARD_URL;
}

/**
 * Auth lives on the dashboard, so the browser must call the page origin.
 * A mis-set or build-time-defaulted env URL must not send a public site to
 * localhost (Chrome Local Network Access prompt + broken sign-up).
 */
export function resolveAuthClientBaseURL(input: {
  configured: string;
  currentOrigin?: string;
}): string {
  const origin = input.currentOrigin?.trim();
  if (origin) return stripTrailingSlash(origin);
  return stripTrailingSlash(input.configured);
}

/** Fail a Vercel production build that still points auth at loopback. */
export function assertProductionAuthUrl(): void {
  if (process.env.VERCEL_ENV !== "production") return;
  const url =
    process.env.NEXT_PUBLIC_DASHBOARD_URL?.trim() ||
    process.env.BETTER_AUTH_URL?.trim() ||
    fallbackAuthUrl();
  if (!isLoopbackUrl(url)) return;
  throw new Error(
    `Dashboard/auth URL is ${url}. A production deploy cannot use a loopback address — set NEXT_PUBLIC_DASHBOARD_URL to the public site origin (e.g. https://app.example.com).`,
  );
}
