import { z } from "zod";

const schema = z.object({
  CAMPAIGN_UNSUBSCRIBE_SECRET: z.string().min(32).optional(),
  NEXT_PUBLIC_WWW_URL: z.string().url().default("http://localhost:4001"),
});

export function keys() {
  return schema.parse({
    CAMPAIGN_UNSUBSCRIBE_SECRET: process.env.CAMPAIGN_UNSUBSCRIBE_SECRET,
    NEXT_PUBLIC_WWW_URL: process.env.NEXT_PUBLIC_WWW_URL,
  });
}
