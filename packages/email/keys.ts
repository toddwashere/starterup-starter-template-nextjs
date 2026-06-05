import { z } from "zod";

const schema = z.object({
  RESEND_API_KEY: z.string().optional(),
  EMAIL_FROM: z.string().default("App <noreply@example.com>"),
  EMAIL_PROVIDER: z.enum(["resend"]).default("resend"),
  RESEND_WEBHOOK_SECRET: z.string().optional(),
});

export function keys() {
  return schema.parse({
    RESEND_API_KEY: process.env.RESEND_API_KEY,
    EMAIL_FROM: process.env.EMAIL_FROM,
    EMAIL_PROVIDER: process.env.EMAIL_PROVIDER,
    RESEND_WEBHOOK_SECRET: process.env.RESEND_WEBHOOK_SECRET,
  });
}
