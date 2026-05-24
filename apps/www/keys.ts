import { z } from "zod";

const schema = z.object({
  NEXT_PUBLIC_DASHBOARD_URL: z.string().url().default("http://localhost:4000"),
  NEXT_PUBLIC_WWW_URL: z.string().url().default("http://localhost:4001"),
});

export function keys() {
  return schema.parse({
    NEXT_PUBLIC_DASHBOARD_URL: process.env.NEXT_PUBLIC_DASHBOARD_URL,
    NEXT_PUBLIC_WWW_URL: process.env.NEXT_PUBLIC_WWW_URL,
  });
}
