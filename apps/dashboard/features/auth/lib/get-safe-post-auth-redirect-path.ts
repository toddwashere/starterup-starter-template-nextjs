/**
 * Resolve a post-auth navigation target from a `redirectTo` query value.
 * Only same-origin relative paths are allowed (open-redirect safe).
 */
export function getSafePostAuthRedirectPath(
  redirectTo: string | null | undefined,
  fallback = "/",
): string {
  if (!redirectTo) {
    return fallback;
  }

  const trimmed = redirectTo.trim();
  if (!trimmed.startsWith("/") || trimmed.startsWith("//")) {
    return fallback;
  }

  // Block scheme-smuggling forms like "/\\evil.com" or embedded absolute URLs
  if (trimmed.includes("://") || trimmed.includes("\\")) {
    return fallback;
  }

  return trimmed;
}

/** Append a sanitized `redirectTo` query param when present and safe. */
export function withRedirectToQuery(
  href: string,
  redirectTo: string | null | undefined,
): string {
  if (!redirectTo?.trim()) {
    return href;
  }

  const safePath = getSafePostAuthRedirectPath(redirectTo, "");
  if (!safePath) {
    return href;
  }

  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}redirectTo=${encodeURIComponent(safePath)}`;
}
