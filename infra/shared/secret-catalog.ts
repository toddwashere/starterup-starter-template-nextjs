export type SecretGeneration = "generated" | "placeholder";

export interface SecretDescriptor {
  /** Secret Manager secretId. */
  id: string;
  /** Env var name injected into Cloud Run from this secret. */
  envVar: string;
  /** "generated" = Pulumi creates a random value; "placeholder" = empty, dev fills. */
  generation: SecretGeneration;
  /** App names whose runtime SA may read this secret. */
  readers: readonly string[];
}

export const SECRET_CATALOG: readonly SecretDescriptor[] = [
  {
    id: "database-url",
    envVar: "DATABASE_URL",
    generation: "generated",
    readers: ["dashboard", "public-api", "public-mcp", "workers"],
  },
  {
    id: "better-auth-secret",
    envVar: "BETTER_AUTH_SECRET",
    generation: "generated",
    readers: ["dashboard", "public-api", "public-mcp"],
  },
  {
    id: "campaign-unsubscribe-secret",
    envVar: "CAMPAIGN_UNSUBSCRIBE_SECRET",
    generation: "generated",
    readers: ["dashboard", "workers"],
  },
  {
    id: "stripe-secret-key",
    envVar: "STRIPE_SECRET_KEY",
    generation: "placeholder",
    // packages/billing/keys.ts requires STRIPE_SECRET_KEY and
    // STRIPE_WEBHOOK_SECRET together; @workspace/auth constructs the Stripe
    // client at module scope, so every app importing auth needs both.
    readers: ["dashboard", "public-api", "public-mcp"],
  },
  {
    id: "stripe-webhook-secret",
    envVar: "STRIPE_WEBHOOK_SECRET",
    generation: "placeholder",
    readers: ["dashboard", "public-api", "public-mcp"],
  },
  {
    id: "resend-api-key",
    envVar: "RESEND_API_KEY",
    generation: "placeholder",
    readers: ["dashboard", "public-api", "workers"],
  },
  {
    id: "openrouter-api-key",
    envVar: "OPENROUTER_API_KEY",
    generation: "placeholder",
    readers: ["dashboard", "workers"],
  },
  {
    id: "sentry-dsn",
    envVar: "SENTRY_DSN",
    generation: "placeholder",
    // www gets Sentry via build-time NEXT_PUBLIC_SENTRY_DSN, not a runtime secret
    readers: ["dashboard", "public-api", "public-mcp", "workers"],
  },
] as const;

export function secretsForApp(app: string): SecretDescriptor[] {
  return SECRET_CATALOG.filter((s) => s.readers.includes(app));
}

export function generatedSecrets(): SecretDescriptor[] {
  return SECRET_CATALOG.filter((s) => s.generation === "generated");
}

export function placeholderSecrets(): SecretDescriptor[] {
  return SECRET_CATALOG.filter((s) => s.generation === "placeholder");
}
