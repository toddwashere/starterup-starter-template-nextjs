import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z
    .string({ required_error: "DATABASE_URL is required" })
    .url("DATABASE_URL must be a valid URL"),
});

export function keys() {
  return schema.parse({
    DATABASE_URL: process.env.DATABASE_URL,
  });
}
