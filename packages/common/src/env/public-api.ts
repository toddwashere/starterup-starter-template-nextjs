import { z } from "zod";

const publicApiUrlSchema = z
  .string({
    required_error:
      "NEXT_PUBLIC_API_URL is required. Add it to .env (see .env.example).",
  })
  .min(1, "NEXT_PUBLIC_API_URL is required. Add it to .env (see .env.example).")
  .url("NEXT_PUBLIC_API_URL must be a valid URL (e.g. http://localhost:4002)")
  .transform((value) => value.trim().replace(/\/$/, ""));

function parsePublicApiUrl(): string {
  const result = publicApiUrlSchema.safeParse(process.env.NEXT_PUBLIC_API_URL);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(message);
  }
  return result.data;
}

let cachedUrl: string | undefined;

/** Validated base URL for the public REST API (no trailing slash). */
export function getPublicApiUrl(): string {
  cachedUrl ??= parsePublicApiUrl();
  return cachedUrl;
}

/** TCP port derived from {@link getPublicApiUrl}. */
export function getPublicApiListenPort(): number {
  const url = new URL(getPublicApiUrl());
  if (url.port) {
    return Number(url.port);
  }
  if (url.protocol === "https:") {
    return 443;
  }
  if (url.protocol === "http:") {
    return 80;
  }
  throw new Error("NEXT_PUBLIC_API_URL must use http: or https:");
}

/** Fail fast when env is missing or invalid (dev, build, server start). */
export function assertPublicApiEnv(): void {
  getPublicApiUrl();
}
