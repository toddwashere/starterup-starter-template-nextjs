import { SECRET_CATALOG, type SecretDescriptor } from "./secret-catalog";

const PLACEHOLDER_SEEDS: Readonly<Record<string, string>> = {
  "better-auth-secret": "replace-me-better-auth-secret-min-32-chars",
  "campaign-unsubscribe-secret": "replace-me-campaign-unsubscribe-secret-min-32",
  "stripe-secret-key": "sk_test_replace_me",
  "stripe-webhook-secret": "whsec_replace_me",
  "resend-api-key": "re_replace_me",
  "openrouter-api-key": "replace-me-openrouter",
  "sentry-dsn": "https://replace.me/sentry",
};

/** Catalog secrets AWS core should create as operator-filled SM placeholders. */
export function awsCatalogAppSecrets(): readonly SecretDescriptor[] {
  return SECRET_CATALOG.filter((s) => s.id !== "database-url");
}

export function awsCatalogPlaceholderSeed(id: string): string {
  const seed = PLACEHOLDER_SEEDS[id];
  if (seed === undefined) {
    throw new Error(`Unknown AWS catalog secret id: ${id}`);
  }
  return seed;
}
