import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_MCP_URL: z
    .string()
    .url()
    .default("http://localhost:4003")
    .transform((v) => v.replace(/\/$/, "")),
});

export function keys() {
  return schema.parse({
    NEXT_PUBLIC_MCP_URL: process.env.NEXT_PUBLIC_MCP_URL,
  });
}
