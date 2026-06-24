import type { SecretDescriptor, SecretGeneration } from "./secret-catalog";

export type SecretFillStatus = "missing" | "empty" | "set";

export interface SecretStatusRow {
  id: string;
  envVar: string;
  generation: SecretGeneration;
  readers: readonly string[];
  status: SecretFillStatus;
}

/** Classify a Secret Manager payload (pure — no I/O). */
export function classifySecretPayload(
  payload: string | null | undefined,
): SecretFillStatus {
  if (payload === null || payload === undefined) return "missing";
  if (payload.trim().length === 0) return "empty";
  return "set";
}

export function buildSecretStatusRows(
  catalog: readonly SecretDescriptor[],
  payloads: Record<string, string | null | undefined>,
): SecretStatusRow[] {
  return catalog.map((secret) => ({
    id: secret.id,
    envVar: secret.envVar,
    generation: secret.generation,
    readers: secret.readers,
    status: classifySecretPayload(payloads[secret.id]),
  }));
}

export function placeholderSecretsNeedingValues(rows: SecretStatusRow[]): SecretStatusRow[] {
  return rows.filter(
    (row) => row.generation === "placeholder" && row.status !== "set",
  );
}

export function formatSecretStatusTable(rows: SecretStatusRow[]): string {
  const idW = Math.max(4, ...rows.map((r) => r.id.length));
  const typeW = 11;
  const statusW = 7;
  const lines = [
    `${"SECRET".padEnd(idW)}  ${"TYPE".padEnd(typeW)}  ${"STATUS".padEnd(statusW)}  READERS`,
    `${"-".repeat(idW)}  ${"-".repeat(typeW)}  ${"-".repeat(statusW)}  -------`,
  ];
  for (const row of rows) {
    lines.push(
      `${row.id.padEnd(idW)}  ${row.generation.padEnd(typeW)}  ${row.status.padEnd(statusW)}  ${row.readers.join(", ")}`,
    );
  }
  return lines.join("\n");
}

export function secretIdFromArg(
  catalog: readonly SecretDescriptor[],
  arg: string,
): SecretDescriptor | undefined {
  const normalized = arg.trim();
  return catalog.find((s) => s.id === normalized || s.envVar === normalized);
}
