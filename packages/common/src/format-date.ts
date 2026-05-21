export function formatDate(
  date: Date | string | number,
  opts?: { includeTime?: boolean; relative?: boolean },
): string {
  const d = date instanceof Date ? date : new Date(date);

  if (opts?.relative) {
    const diffMs = Date.now() - d.getTime();
    const absMinutes = Math.floor(Math.abs(diffMs) / 60_000);
    const absHours = Math.floor(Math.abs(diffMs) / 3_600_000);
    const absDays = Math.floor(Math.abs(diffMs) / 86_400_000);
    const future = diffMs < 0;

    if (absMinutes < 1) return "just now";
    if (absMinutes < 60)
      return future ? `in ${absMinutes} minutes` : `${absMinutes} minutes ago`;
    if (absHours < 24)
      return future ? `in ${absHours} hours` : `${absHours} hours ago`;
    return future ? `in ${absDays} days` : `${absDays} days ago`;
  }

  if (opts?.includeTime) {
    return new Intl.DateTimeFormat("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(d);
  }

  return new Intl.DateTimeFormat("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(d);
}
