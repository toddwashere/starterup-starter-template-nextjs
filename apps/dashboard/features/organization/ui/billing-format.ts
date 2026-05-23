/**
 * Turn a limit key like `contacts` or `apiKeys` into a human label
 * ("Contacts", "Api Keys") for display in billing UI.
 */
export function formatLimitLabel(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim();
  return spaced
    .split(" ")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}
