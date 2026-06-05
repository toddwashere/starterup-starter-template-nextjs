export type DatabaseReadinessStatus = {
  databaseConnected: boolean;
  status: "ready" | "not-ready";
  message: string;
};

type FetchLike = (
  input: string,
  init?: RequestInit,
) => Promise<Pick<Response, "ok" | "status" | "json">>;

function isReadyPayload(value: unknown): value is { db: boolean } {
  return (
    typeof value === "object" &&
    value !== null &&
    "db" in value &&
    typeof value.db === "boolean"
  );
}

export async function getDatabaseReadinessStatus(
  fetchImpl: FetchLike = fetch,
): Promise<DatabaseReadinessStatus> {
  try {
    const response = await fetchImpl("/api/ready", { cache: "no-store" });
    const payload: unknown = await response.json();
    const databaseConnected =
      response.ok && isReadyPayload(payload) && payload.db;

    return {
      databaseConnected,
      status: databaseConnected ? "ready" : "not-ready",
      message: databaseConnected
        ? "Database connection is healthy."
        : "Database connection is unavailable.",
    };
  } catch {
    return {
      databaseConnected: false,
      status: "not-ready",
      message: "Database connection could not be checked.",
    };
  }
}
