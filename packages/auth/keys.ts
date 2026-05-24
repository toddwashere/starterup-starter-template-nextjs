import { z } from "zod";

const schema = z
  .object({
    BETTER_AUTH_URL: z.string().url().default("http://localhost:4000"),
    NEXT_PUBLIC_BETTER_AUTH_URL: z
      .string()
      .url()
      .default("http://localhost:4000"),
    GOOGLE_CLIENT_ID: z.string().optional(),
    GOOGLE_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_CLIENT_ID: z.string().optional(),
    MICROSOFT_CLIENT_SECRET: z.string().optional(),
    MICROSOFT_TENANT_ID: z.string().default("common"),
  })
  .superRefine((val, ctx) => {
    if (val.GOOGLE_CLIENT_ID && !val.GOOGLE_CLIENT_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["GOOGLE_CLIENT_SECRET"],
        message: "Required when GOOGLE_CLIENT_ID is set",
      });
    }
    if (val.MICROSOFT_CLIENT_ID && !val.MICROSOFT_CLIENT_SECRET) {
      ctx.addIssue({
        code: "custom",
        path: ["MICROSOFT_CLIENT_SECRET"],
        message: "Required when MICROSOFT_CLIENT_ID is set",
      });
    }
  });

export function keys() {
  return schema.parse({
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL,
    NEXT_PUBLIC_BETTER_AUTH_URL: process.env.NEXT_PUBLIC_BETTER_AUTH_URL,
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
  });
}
