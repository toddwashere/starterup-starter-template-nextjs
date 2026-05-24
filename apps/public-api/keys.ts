import { z } from "zod";

const schema = z.object({
  PUBLIC_API_PORT: z.coerce.number().int().positive().default(4002),
});

export function keys() {
  return schema.parse({
    PUBLIC_API_PORT: process.env.PUBLIC_API_PORT,
  });
}
