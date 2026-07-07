/** Returns a finite positive integer pool cap, defaulting to 5 for invalid input. */
export function resolvePoolMax(raw?: string): number {
  const parsed = parseInt(raw ?? "5", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 5;
}
