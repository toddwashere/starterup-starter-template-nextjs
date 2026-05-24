import { z } from "zod";

const schema = z.object({
  EMAIL_PREVIEW_PORT: z.coerce.number().int().positive().default(4004),
});

export function keys() {
  return schema.parse({
    EMAIL_PREVIEW_PORT: process.env.EMAIL_PREVIEW_PORT,
  });
}
