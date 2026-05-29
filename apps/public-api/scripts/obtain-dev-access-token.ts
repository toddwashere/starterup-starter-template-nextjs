#!/usr/bin/env tsx
/**
 * obtain-dev-access-token.ts — LOCAL DEV ONLY
 * ----------------------------------------------------------------------------
 * Obtains an OAuth 2.0 access token for the public API by driving an
 * Authorization Code + PKCE (S256) flow against the local Better Auth server,
 * as headlessly as possible. Intended purely for local smoke testing; it never
 * stores or commits secrets and prints only the credentials you supply.
 *
 * What it does:
 *   1. (optionally) Registers the smoke user via POST {API_BASE_URL}/v1/auth/register.
 *   2. Discovers OAuth endpoints from the auth server's RFC 8414 metadata
 *      (falling back to documented defaults if discovery fails).
 *   3. Dynamically registers a public OAuth client (unless SMOKE_OAUTH_CLIENT_ID set).
 *   4. Signs in via Better Auth email/password to obtain a session cookie.
 *   5. Calls the authorize endpoint with the session cookie + PKCE params to get
 *      an authorization code, then exchanges it at the token endpoint.
 *   6. Prints the token (human summary, or `export ...` lines with --print-env).
 *
 * Environment variables (all have local defaults except credentials):
 *   AUTH_BASE_URL            Auth server base. Default: $BETTER_AUTH_URL or http://localhost:4000
 *   API_BASE_URL             Public API base.  Default: $NEXT_PUBLIC_API_URL or http://localhost:4002
 *   SMOKE_EMAIL              Smoke user email.    Default: smoke-dev@example.com
 *   SMOKE_PASSWORD           Smoke user password. Default: smoke-dev-password-123
 *   SMOKE_NAME               Smoke user name.     Default: "Smoke Dev"
 *   SMOKE_OAUTH_REDIRECT_URI Redirect URI.        Default: http://localhost:19006/redirect (Expo-style)
 *   SMOKE_OAUTH_CLIENT_ID    Existing public client id. If absent, a client is registered dynamically.
 *
 * Flags:
 *   --register     Always attempt user registration first (a 400 "already exists" is ignored).
 *   --print-env    Print ONLY `export ACCESS_TOKEN=...` / `export API_BASE_URL=...` to stdout
 *                  (everything else goes to stderr), for: eval "$(... smoke:token --print-env)".
 *   --help, -h     Show usage and exit.
 *
 * Usage:
 *   pnpm --filter @apps/public-api smoke:token
 *   eval "$(pnpm --filter @apps/public-api smoke:token --print-env)"
 *
 * Requires Node 22+ (global fetch). No third-party dependencies.
 */

import { randomBytes, createHash } from "node:crypto";

// ---------------------------------------------------------------------------
// Output helpers — in --print-env mode stdout must contain ONLY export lines.
// ---------------------------------------------------------------------------
const args = new Set(process.argv.slice(2));
const PRINT_ENV = args.has("--print-env");
const ALWAYS_REGISTER = args.has("--register");
const WANT_HELP = args.has("--help") || args.has("-h");

/** Diagnostics always go to stderr so --print-env stdout stays clean. */
function log(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

function fail(msg: string): never {
  process.stderr.write(`\nerror: ${msg}\n`);
  process.exit(1);
}

function printHelp(): void {
  // Echo the top-of-file doc block's essentials.
  process.stdout.write(
    `obtain-dev-access-token — local dev OAuth PKCE helper\n\n` +
      `Usage:\n` +
      `  pnpm --filter @apps/public-api smoke:token [--register] [--print-env]\n\n` +
      `Flags:\n` +
      `  --register    Attempt user registration first (ignores "already exists").\n` +
      `  --print-env   Print only \`export ACCESS_TOKEN=...\` lines (for eval).\n` +
      `  --help, -h    Show this help.\n\n` +
      `Env (defaults shown):\n` +
      `  AUTH_BASE_URL=http://localhost:4000   (or $BETTER_AUTH_URL)\n` +
      `  API_BASE_URL=http://localhost:4002    (or $NEXT_PUBLIC_API_URL)\n` +
      `  SMOKE_EMAIL=smoke-dev@example.com\n` +
      `  SMOKE_PASSWORD=smoke-dev-password-123\n` +
      `  SMOKE_NAME="Smoke Dev"\n` +
      `  SMOKE_OAUTH_REDIRECT_URI=http://localhost:19006/redirect\n` +
      `  SMOKE_OAUTH_CLIENT_ID=<optional; dynamically registered if unset>\n`,
  );
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const stripSlash = (u: string) => u.replace(/\/+$/, "");

const AUTH_BASE_URL = stripSlash(
  process.env.AUTH_BASE_URL || process.env.BETTER_AUTH_URL || "http://localhost:4000",
);
const API_BASE_URL = stripSlash(
  process.env.API_BASE_URL || process.env.NEXT_PUBLIC_API_URL || "http://localhost:4002",
);
const SMOKE_EMAIL = process.env.SMOKE_EMAIL || "smoke-dev@example.com";
const SMOKE_PASSWORD = process.env.SMOKE_PASSWORD || "smoke-dev-password-123";
const SMOKE_NAME = process.env.SMOKE_NAME || "Smoke Dev";
const REDIRECT_URI =
  process.env.SMOKE_OAUTH_REDIRECT_URI || "http://localhost:19006/redirect";
const CLIENT_ID_FROM_ENV = process.env.SMOKE_OAUTH_CLIENT_ID || "";
const SCOPE = "account:read offline_access";

// Better Auth mounts its handler at {AUTH_BASE_URL}/api/auth; the oauth-provider
// plugin exposes /oauth2/* under that. Documented fallbacks if discovery fails:
const AUTH_API_BASE = `${AUTH_BASE_URL}/api/auth`;
const DEFAULT_AUTHORIZE_ENDPOINT = `${AUTH_API_BASE}/oauth2/authorize`;
const DEFAULT_TOKEN_ENDPOINT = `${AUTH_API_BASE}/oauth2/token`;
const DEFAULT_REGISTRATION_ENDPOINT = `${AUTH_API_BASE}/oauth2/register`;
const SIGN_IN_ENDPOINT = `${AUTH_API_BASE}/sign-in/email`;
// RFC 8414 well-known route (served by the dashboard Next.js app):
const WELL_KNOWN_URLS = [
  `${AUTH_BASE_URL}/.well-known/oauth-authorization-server/api/auth`,
  `${AUTH_BASE_URL}/.well-known/oauth-authorization-server`,
  `${AUTH_API_BASE}/.well-known/oauth-authorization-server`,
];

// ---------------------------------------------------------------------------
// PKCE (S256) using Node crypto — never Math.random.
// ---------------------------------------------------------------------------
const base64url = (buf: Buffer): string =>
  buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

function createPkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32)); // 43-char high-entropy verifier
  const challenge = base64url(createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

const randomState = (): string => base64url(randomBytes(16));

// ---------------------------------------------------------------------------
// HTTP helpers with reachability diagnostics.
// ---------------------------------------------------------------------------
async function safeFetch(
  url: string,
  init: RequestInit & { redirect?: RequestRedirect } = {},
  contextLabel: string,
): Promise<Response> {
  try {
    return await fetch(url, init);
  } catch (err) {
    const cause = err instanceof Error ? err.message : String(err);
    fail(
      `could not reach ${contextLabel} at ${url}\n` +
        `  reason: ${cause}\n` +
        `  Is the server running? (auth on ${AUTH_BASE_URL}, public-api on ${API_BASE_URL})`,
    );
  }
}

/** Collect Set-Cookie header(s) into a single Cookie request header value. */
function collectCookies(res: Response, existing = ""): string {
  // Node's fetch exposes combined Set-Cookie via getSetCookie() (Node 18.14+).
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const setCookies =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : ((): string[] => {
          const raw = res.headers.get("set-cookie");
          return raw ? [raw] : [];
        })();
  const jar = new Map<string, string>();
  for (const pair of existing.split("; ").filter(Boolean)) {
    const eq = pair.indexOf("=");
    if (eq > 0) jar.set(pair.slice(0, eq), pair.slice(eq + 1));
  }
  for (const c of setCookies) {
    const first = c.split(";")[0];
    const eq = first.indexOf("=");
    if (eq > 0) jar.set(first.slice(0, eq), first.slice(eq + 1));
  }
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

// ---------------------------------------------------------------------------
// Step 1: optional user registration via public-api.
// ---------------------------------------------------------------------------
async function ensureUserRegistered(): Promise<void> {
  const url = `${API_BASE_URL}/v1/auth/register`;
  log(`-> registering user ${SMOKE_EMAIL} via ${url}`);
  const res = await safeFetch(
    url,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: SMOKE_NAME, email: SMOKE_EMAIL, password: SMOKE_PASSWORD }),
    },
    "public-api",
  );
  if (res.status === 201) {
    log(`   registered new user`);
    return;
  }
  if (res.status === 400) {
    // Duplicate email / already exists — fine, we'll just sign in.
    log(`   user already exists (400) — continuing to sign-in`);
    return;
  }
  const body = await res.text().catch(() => "");
  fail(`unexpected ${res.status} from ${url}: ${body.slice(0, 300)}`);
}

// ---------------------------------------------------------------------------
// Step 2: discover OAuth endpoints from RFC 8414 metadata, fall back to defaults.
// ---------------------------------------------------------------------------
interface OAuthEndpoints {
  authorize: string;
  token: string;
  registration: string;
  discovered: boolean;
}

async function discoverEndpoints(): Promise<OAuthEndpoints> {
  for (const url of WELL_KNOWN_URLS) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) continue;
      const meta = (await res.json()) as Record<string, unknown>;
      const authorize = meta.authorization_endpoint;
      const token = meta.token_endpoint;
      if (typeof authorize === "string" && typeof token === "string") {
        log(`-> discovered OAuth endpoints from ${url}`);
        return {
          authorize,
          token,
          registration:
            typeof meta.registration_endpoint === "string"
              ? meta.registration_endpoint
              : DEFAULT_REGISTRATION_ENDPOINT,
          discovered: true,
        };
      }
    } catch {
      // try next candidate
    }
  }
  log(
    `-> WARNING: OAuth metadata discovery failed (tried ${WELL_KNOWN_URLS.join(", ")}).\n` +
      `   Falling back to documented defaults under ${AUTH_API_BASE}/oauth2/*`,
  );
  return {
    authorize: DEFAULT_AUTHORIZE_ENDPOINT,
    token: DEFAULT_TOKEN_ENDPOINT,
    registration: DEFAULT_REGISTRATION_ENDPOINT,
    discovered: false,
  };
}

// ---------------------------------------------------------------------------
// Step 3: dynamic client registration (public client, PKCE, no secret).
// ---------------------------------------------------------------------------
async function registerClient(registrationEndpoint: string): Promise<string> {
  log(`-> registering dynamic OAuth client at ${registrationEndpoint}`);
  const res = await safeFetch(
    registrationEndpoint,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "public-api-smoke-cli",
        redirect_uris: [REDIRECT_URI],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none", // public client
        scope: SCOPE,
      }),
    },
    "auth server (dynamic client registration)",
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(
      `dynamic client registration failed (${res.status}) at ${registrationEndpoint}\n` +
        `  ${body.slice(0, 400)}\n` +
        `  Tip: set SMOKE_OAUTH_CLIENT_ID to reuse an existing public client.`,
    );
  }
  const data = (await res.json()) as { client_id?: string };
  if (!data.client_id) {
    fail(`registration response had no client_id: ${JSON.stringify(data).slice(0, 300)}`);
  }
  log(`   registered client_id=${data.client_id}`);
  return data.client_id;
}

// ---------------------------------------------------------------------------
// Step 4: email/password sign-in -> session cookie.
// ---------------------------------------------------------------------------
async function signIn(): Promise<string> {
  log(`-> signing in ${SMOKE_EMAIL} via ${SIGN_IN_ENDPOINT}`);
  const res = await safeFetch(
    SIGN_IN_ENDPOINT,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: SMOKE_EMAIL, password: SMOKE_PASSWORD }),
      redirect: "manual",
    },
    "auth server (sign-in)",
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(
      `sign-in failed (${res.status}) at ${SIGN_IN_ENDPOINT}\n` +
        `  ${body.slice(0, 300)}\n` +
        `  Check SMOKE_EMAIL / SMOKE_PASSWORD, or pass --register to create the user.`,
    );
  }
  const cookie = collectCookies(res);
  if (!cookie) {
    fail(`sign-in succeeded but no session cookie was returned by ${SIGN_IN_ENDPOINT}`);
  }
  log(`   session established`);
  return cookie;
}

// ---------------------------------------------------------------------------
// Step 5: authorize (with session cookie + PKCE) -> authorization code.
// ---------------------------------------------------------------------------
function buildAuthorizeUrl(
  authorizeEndpoint: string,
  clientId: string,
  challenge: string,
  state: string,
): string {
  const u = new URL(authorizeEndpoint);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", REDIRECT_URI);
  u.searchParams.set("scope", SCOPE);
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", challenge);
  u.searchParams.set("code_challenge_method", "S256");
  return u.toString();
}

/** Extract `code` from a redirect Location targeting our redirect_uri. */
function codeFromLocation(location: string | null, expectedState: string): string | null {
  if (!location) return null;
  let target: URL;
  try {
    target = new URL(location, REDIRECT_URI);
  } catch {
    return null;
  }
  const code = target.searchParams.get("code");
  const state = target.searchParams.get("state");
  if (code && (!state || state === expectedState)) return code;
  return null;
}

async function authorize(
  authorizeEndpoint: string,
  clientId: string,
  cookie: string,
  challenge: string,
  state: string,
): Promise<string> {
  const authorizeUrl = buildAuthorizeUrl(authorizeEndpoint, clientId, challenge, state);
  log(`-> requesting authorization code (headless) from ${authorizeEndpoint}`);

  // Follow redirects manually so we can capture the code and detect consent/login pages.
  let currentUrl = authorizeUrl;
  let jar = cookie;
  for (let hop = 0; hop < 5; hop += 1) {
    const res = await safeFetch(
      currentUrl,
      { method: "GET", headers: { cookie: jar, accept: "text/html" }, redirect: "manual" },
      "auth server (authorize)",
    );
    jar = collectCookies(res, jar);
    const location = res.headers.get("location");

    if (res.status >= 300 && res.status < 400 && location) {
      const code = codeFromLocation(location, state);
      if (code) {
        log(`   received authorization code`);
        return code;
      }
      // Redirected to login/consent page — headless flow blocked.
      if (/\/consent|\/sign-in|\/login/i.test(location)) {
        printConsentInstructions(authorizeUrl, location);
      }
      currentUrl = new URL(location, currentUrl).toString();
      continue;
    }

    // Non-redirect: likely an HTML consent page rendered inline.
    const body = await res.text().catch(() => "");
    if (/consent|authorize|approve/i.test(body)) {
      printConsentInstructions(authorizeUrl, currentUrl);
    }
    fail(
      `authorize did not yield a code (status ${res.status}).\n` +
        `  The consent/login step likely requires a browser. See instructions above.`,
    );
  }
  fail(`authorize exceeded redirect limit without producing a code.`);
}

function printConsentInstructions(authorizeUrl: string, blockedAt: string): void {
  log(
    `\n-> Headless authorization was blocked (consent/login page at ${blockedAt}).\n` +
      `   Complete the flow manually in a browser:\n` +
      `     1. Open: ${authorizeUrl}\n` +
      `     2. Sign in / approve consent.\n` +
      `     3. Copy the \`code\` query param from the redirect to ${REDIRECT_URI}.\n` +
      `     4. Exchange it at the token endpoint with your code_verifier.\n` +
      `   (This dev helper attempts a fully headless flow; some configs require the browser step.)`,
  );
}

// ---------------------------------------------------------------------------
// Step 6: token exchange.
// ---------------------------------------------------------------------------
interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

async function exchangeCode(
  tokenEndpoint: string,
  clientId: string,
  code: string,
  verifier: string,
): Promise<TokenResponse> {
  log(`-> exchanging authorization code at ${tokenEndpoint}`);
  const form = new URLSearchParams({
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    client_id: clientId,
    code_verifier: verifier,
  });
  const res = await safeFetch(
    tokenEndpoint,
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
      body: form.toString(),
    },
    "auth server (token)",
  );
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    fail(`token exchange failed (${res.status}) at ${tokenEndpoint}\n  ${body.slice(0, 400)}`);
  }
  const data = (await res.json()) as TokenResponse;
  if (!data.access_token) {
    fail(`token response had no access_token: ${JSON.stringify(data).slice(0, 300)}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main(): Promise<void> {
  if (WANT_HELP) {
    printHelp();
    process.exit(0);
  }

  log(`auth=${AUTH_BASE_URL}  api=${API_BASE_URL}  user=${SMOKE_EMAIL}`);

  // Always attempt registration (best-effort): a 400 "already exists" is ignored,
  // so the flow is idempotent/repeatable. --register just makes this explicit.
  if (ALWAYS_REGISTER) log(`-> --register passed (registration is attempted by default)`);
  await ensureUserRegistered();

  const endpoints = await discoverEndpoints();
  const clientId = CLIENT_ID_FROM_ENV || (await registerClient(endpoints.registration));

  const cookie = await signIn();
  const { verifier, challenge } = createPkce();
  const state = randomState();
  const code = await authorize(endpoints.authorize, clientId, cookie, challenge, state);
  const token = await exchangeCode(endpoints.token, clientId, code, verifier);

  if (PRINT_ENV) {
    // stdout: ONLY the export lines (safe for eval).
    process.stdout.write(`export ACCESS_TOKEN=${token.access_token}\n`);
    process.stdout.write(`export API_BASE_URL=${API_BASE_URL}\n`);
    log(`\nDone. Access token obtained (scope: ${token.scope ?? SCOPE}).`);
    return;
  }

  // Human summary (note: prints the token so you can copy it for local use).
  const masked = `${token.access_token.slice(0, 8)}…${token.access_token.slice(-4)}`;
  log(`\nAccess token obtained.`);
  log(`  token_type : ${token.token_type ?? "Bearer"}`);
  log(`  scope      : ${token.scope ?? SCOPE}`);
  if (token.expires_in) log(`  expires_in : ${token.expires_in}s`);
  log(`  refresh    : ${token.refresh_token ? "yes" : "no"}`);
  log(`  access     : ${masked}`);
  log(`\nTo use it in the smoke script:`);
  log(`  eval "$(pnpm --filter @apps/public-api smoke:token --print-env)"`);
  log(`  ./apps/public-api/scripts/smoke-mobile-auth.sh`);
  log(`\nFull access token (local dev only):`);
  process.stdout.write(`${token.access_token}\n`);
}

main().catch((err) => {
  // Last-resort guard: never emit an unhandled rejection / raw stack to the user.
  const msg = err instanceof Error ? err.message : String(err);
  fail(`unexpected failure: ${msg}`);
});
