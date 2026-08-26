import { z } from "zod";
import { fallbackAuthUrl } from "@workspace/auth/keys";

const schema = z.object({
  NEXT_PUBLIC_DASHBOARD_URL: z.string().url(),
  NEXT_PUBLIC_WWW_URL: z.string().url().default("http://localhost:4001"),
  NEXT_PUBLIC_API_URL: z.string().url().default("http://localhost:4002"),
  NEXT_PUBLIC_MCP_URL: z.string().url().default("http://localhost:4003"),
  BETTER_AUTH_URL: z.string().url(),
});

export function keys() {
  const dashboard = process.env.NEXT_PUBLIC_DASHBOARD_URL || fallbackAuthUrl();
  return schema.parse({
    NEXT_PUBLIC_DASHBOARD_URL: dashboard,
    NEXT_PUBLIC_WWW_URL: process.env.NEXT_PUBLIC_WWW_URL,
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_MCP_URL: process.env.NEXT_PUBLIC_MCP_URL,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || dashboard,
  });
}
