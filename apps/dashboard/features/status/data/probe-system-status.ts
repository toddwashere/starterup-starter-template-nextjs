import { prisma } from "@workspace/database";
import { keys as authKeys } from "@workspace/auth/keys";
import {
  buildSystemStatus,
  type EnvMap,
  type ProbeResults,
  type SystemStatus,
} from "./system-status";

const AUTH_PROBE_TIMEOUT_MS = 2_000;
/** Cache public probes so scrapers cannot hammer dependencies. */
const PROBE_CACHE_TTL_MS = 15_000;

type TimedProbeResult = {
  ok: boolean;
  latencyMs: number | null;
};

let dbProbeCache: { at: number; result: TimedProbeResult } | null = null;
let dbProbeInFlight: Promise<TimedProbeResult> | null = null;
let authProbeCache: { at: number; result: TimedProbeResult } | null = null;
let authProbeInFlight: Promise<TimedProbeResult> | null = null;

/** Clears in-process probe caches (for tests). */
export function resetDbProbeCache(): void {
  dbProbeCache = null;
  dbProbeInFlight = null;
  authProbeCache = null;
  authProbeInFlight = null;
}

async function runDatabaseProbe(): Promise<TimedProbeResult> {
  const started = performance.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    return {
      ok: true,
      latencyMs: Math.round(performance.now() - started),
    };
  } catch {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

async function probeDatabase(): Promise<TimedProbeResult> {
  const now = Date.now();
  if (dbProbeCache && now - dbProbeCache.at < PROBE_CACHE_TTL_MS) {
    return dbProbeCache.result;
  }
  if (dbProbeInFlight) {
    return dbProbeInFlight;
  }

  dbProbeInFlight = runDatabaseProbe()
    .then((result) => {
      dbProbeCache = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      dbProbeInFlight = null;
    });

  return dbProbeInFlight;
}

async function runAuthProbe(
  fetchImpl: typeof fetch,
): Promise<TimedProbeResult> {
  const started = performance.now();
  try {
    const baseUrl = authKeys().BETTER_AUTH_URL.replace(/\/$/, "");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AUTH_PROBE_TIMEOUT_MS);
    try {
      const response = await fetchImpl(`${baseUrl}/api/auth/get-session`, {
        method: "GET",
        cache: "no-store",
        signal: controller.signal,
        headers: { accept: "application/json" },
      });
      // Any HTTP response means the auth handler is reachable (401/null session is fine).
      const ok = response.status > 0 && response.status < 500;
      return {
        ok,
        latencyMs: Math.round(performance.now() - started),
      };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - started),
    };
  }
}

async function probeAuth(
  fetchImpl: typeof fetch = fetch,
): Promise<TimedProbeResult> {
  const now = Date.now();
  if (authProbeCache && now - authProbeCache.at < PROBE_CACHE_TTL_MS) {
    return authProbeCache.result;
  }
  if (authProbeInFlight) {
    return authProbeInFlight;
  }

  authProbeInFlight = runAuthProbe(fetchImpl)
    .then((result) => {
      authProbeCache = { at: Date.now(), result };
      return result;
    })
    .finally(() => {
      authProbeInFlight = null;
    });

  return authProbeInFlight;
}

export async function getSystemStatus(
  fetchImpl: typeof fetch = fetch,
  env: EnvMap = process.env,
): Promise<SystemStatus> {
  const [database, auth] = await Promise.all([
    probeDatabase(),
    probeAuth(fetchImpl),
  ]);

  const probes: ProbeResults = {
    databaseOk: database.ok,
    databaseLatencyMs: database.latencyMs,
    authOk: auth.ok,
    authLatencyMs: auth.latencyMs,
  };
  return buildSystemStatus(probes, env);
}
