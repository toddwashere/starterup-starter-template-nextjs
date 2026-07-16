import { z } from "zod";

const publicMcpUrlSchema = z
  .string({
    required_error: "NEXT_PUBLIC_MCP_URL is required. Add it to .env (see .env.example).",
  })
  .min(1, "NEXT_PUBLIC_MCP_URL is required. Add it to .env (see .env.example).")
  .url("NEXT_PUBLIC_MCP_URL must be a valid URL (e.g. http://localhost:4003)")
  .transform((value) => value.trim().replace(/\/$/, ""));

function parsePublicMcpUrl(): string {
  const result = publicMcpUrlSchema.safeParse(process.env.NEXT_PUBLIC_MCP_URL);
  if (!result.success) {
    const message = result.error.issues.map((issue) => issue.message).join("; ");
    throw new Error(message);
  }
  return result.data;
}

let cachedUrl: string | undefined;

/** Validated base URL for the public MCP server (no trailing slash). */
export function getPublicMcpUrl(): string {
  cachedUrl ??= parsePublicMcpUrl();
  return cachedUrl;
}

/** MCP Streamable HTTP endpoint. */
export function getPublicMcpEndpoint(): string {
  return `${getPublicMcpUrl()}/mcp`;
}

/**
 * TCP listen port.
 *
 * Prefer `PORT` / `PUBLIC_MCP_PORT` (App Runner and containers set `PORT`) so a
 * public HTTPS URL without an explicit port does not force listen on 443.
 * Fall back to the port embedded in {@link getPublicMcpUrl}.
 */
export function getPublicMcpListenPort(): number {
  const fromEnv = process.env.PORT ?? process.env.PUBLIC_MCP_PORT;
  if (fromEnv) {
    const parsed = Number(fromEnv);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }

  const url = new URL(getPublicMcpUrl());
  if (url.port) {
    return Number(url.port);
  }
  if (url.protocol === "https:") {
    return 443;
  }
  if (url.protocol === "http:") {
    return 80;
  }
  throw new Error("NEXT_PUBLIC_MCP_URL must use http: or https:");
}

/** Fail fast when env is missing or invalid (dev, build, server start). */
export function assertPublicMcpEnv(): void {
  getPublicMcpUrl();
}
