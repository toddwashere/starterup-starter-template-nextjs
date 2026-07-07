import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .url("DATABASE_URL must be a valid URL"),
  DIRECT_URL: z.string().url("DIRECT_URL must be a valid URL").optional(),
});

export function keys() {
  const parsed = schema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
    DIRECT_URL: process.env.DIRECT_URL,
  });
  return {
    DATABASE_URL: parsed.DATABASE_URL,
    DIRECT_URL: parsed.DIRECT_URL ?? parsed.DATABASE_URL,
  };
}
