import { z } from "zod";

const schema = z.object({
  PUBLIC_API_PORT: z.coerce.number().int().positive().default(4002),
});

export function keys() {
  return schema.parse({
    // App Runner / containers set PORT; keep PUBLIC_API_PORT for local overrides.
    PUBLIC_API_PORT: process.env.PUBLIC_API_PORT ?? process.env.PORT,
  });
}
