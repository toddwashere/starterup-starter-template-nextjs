import { prisma } from "@workspace/database";
import { keys as authKeys } from "@workspace/auth/keys";
import {
  buildSystemStatus,
  type EnvMap,
  type ProbeResults,
  type SystemStatus,
} from "./system-status";

const AUTH_PROBE_TIMEOUT_MS = 2_000;
/** Cache public DB probes so scrapers cannot hammer Postgres. */
const DB_PROBE_CACHE_TTL_MS = 15_000;

type DbProbeResult = {
  ok: boolean;
  latencyMs: number | null;
};

let dbProbeCache: { at: number; result: DbProbeResult } | null = null;
let dbProbeInFlight: Promise<DbProbeResult> | null = null;

/** Clears the in-process DB probe cache (for tests). */
export function resetDbProbeCache(): void {
  dbProbeCache = null;
  dbProbeInFlight = null;
}

async function runDatabaseProbe(): Promise<DbProbeResult> {
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

async function probeDatabase(): Promise<DbProbeResult> {
  const now = Date.now();
  if (dbProbeCache && now - dbProbeCache.at < DB_PROBE_CACHE_TTL_MS) {
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

async function probeAuth(
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
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
      return response.status > 0 && response.status < 500;
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return false;
  }
}

export async function getSystemStatus(
  fetchImpl: typeof fetch = fetch,
  env: EnvMap = process.env,
): Promise<SystemStatus> {
  const [database, authOk] = await Promise.all([
    probeDatabase(),
    probeAuth(fetchImpl),
  ]);

  const probes: ProbeResults = {
    databaseOk: database.ok,
    databaseLatencyMs: database.latencyMs,
    authOk,
  };
  return buildSystemStatus(probes, env);
}
