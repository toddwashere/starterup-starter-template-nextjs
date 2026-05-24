import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const DEFAULT_POSTHOG_HOST = "https://us.i.posthog.com";

const schema = z.object({
  SENTRY_DSN: optionalString,
  NEXT_PUBLIC_POSTHOG_TOKEN: optionalString,
  NEXT_PUBLIC_POSTHOG_HOST: optionalString,
});

export function keys() {
  const parsed = schema.parse({
    SENTRY_DSN: process.env.SENTRY_DSN,
    NEXT_PUBLIC_POSTHOG_TOKEN: process.env.NEXT_PUBLIC_POSTHOG_TOKEN,
    NEXT_PUBLIC_POSTHOG_HOST: process.env.NEXT_PUBLIC_POSTHOG_HOST,
  });

  return {
    ...parsed,
    posthogHost: parsed.NEXT_PUBLIC_POSTHOG_HOST ?? DEFAULT_POSTHOG_HOST,
  };
}

/** Client bundles read DSN injected by withSentryConfig (see next/with-sentry-config.ts). */
export function clientDsn(): string | undefined {
  const fromPublic = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (fromPublic && fromPublic.length > 0) return fromPublic;
  return keys().SENTRY_DSN;
}
