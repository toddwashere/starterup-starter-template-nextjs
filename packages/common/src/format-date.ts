import { format, formatDistanceToNowStrict } from "date-fns";

export function formatDate(
  date: Date | string | number,
  opts?: { includeTime?: boolean; relative?: boolean },
): string {
  const d = date instanceof Date ? date : new Date(date);

  if (opts?.relative) {
    const diffMs = Math.abs(Date.now() - d.getTime());
    if (diffMs < 60_000) return "just now";
    return formatDistanceToNowStrict(d, { addSuffix: true });
  }

  if (opts?.includeTime) {
    return format(d, "MMMM d, yyyy, h:mm a");
  }

  return format(d, "MMMM d, yyyy");
}
