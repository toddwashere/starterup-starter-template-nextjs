import { z } from "zod";

const optionalString = z
  .string()
  .optional()
  .transform((v) => (v === "" ? undefined : v));

const schema = z.object({
  SENTRY_DSN: optionalString,
});

export function keys() {
  return schema.parse({
    SENTRY_DSN: process.env.SENTRY_DSN,
  });
}

/** Client bundles read DSN injected by withSentryConfig (see next/with-sentry-config.ts). */
export function clientDsn(): string | undefined {
  const fromPublic = process.env.NEXT_PUBLIC_SENTRY_DSN;
  if (fromPublic && fromPublic.length > 0) return fromPublic;
  return keys().SENTRY_DSN;
}
