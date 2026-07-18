import { prisma } from "@workspace/database";
import { keys as authKeys } from "@workspace/auth/keys";
import {
  buildSystemStatus,
  type EnvMap,
  type ProbeResults,
  type SystemStatus,
} from "./system-status";

const AUTH_PROBE_TIMEOUT_MS = 2_000;

async function probeDatabase(): Promise<boolean> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
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
  const [databaseOk, authOk] = await Promise.all([
    probeDatabase(),
    probeAuth(fetchImpl),
  ]);

  const probes: ProbeResults = { databaseOk, authOk };
  return buildSystemStatus(probes, env);
}
