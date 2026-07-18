import type { SystemStatus } from "./system-status";

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

function isSystemStatus(value: unknown): value is SystemStatus {
  if (typeof value !== "object" || value === null) return false;
  if (!("status" in value) || !("checks" in value)) return false;
  const record = value as { status: unknown; checks: unknown };
  return (
    (record.status === "ready" || record.status === "not-ready") &&
    Array.isArray(record.checks)
  );
}

export async function fetchSystemStatus(
  fetchImpl: FetchLike = fetch,
): Promise<SystemStatus> {
  try {
    const response = await fetchImpl("/api/status", { cache: "no-store" });
    const payload: unknown = await response.json();
    if (isSystemStatus(payload)) {
      return payload;
    }
    return {
      status: "not-ready",
      checks: [
        {
          id: "database",
          label: "Database connection",
          state: "not-ready",
          message: "Status response was invalid.",
        },
      ],
    };
  } catch {
    return {
      status: "not-ready",
      checks: [
        {
          id: "database",
          label: "Database connection",
          state: "not-ready",
          message: "System status could not be checked.",
        },
      ],
    };
  }
}
