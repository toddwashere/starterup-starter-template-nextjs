import { z } from "zod";
import { fallbackAuthUrl } from "./src/auth-base-url";

const BETTER_AUTH_DEV_SECRET = "better-auth-secret-12345678901234567890";

export { fallbackAuthUrl, assertProductionAuthUrl } from "./src/auth-base-url";

const schema = z
  .object({
    BETTER_AUTH_SECRET: z.string().min(32).default(BETTER_AUTH_DEV_SECRET),
    // Auth is hosted on the dashboard. BETTER_AUTH_URL is an optional override;
    // otherwise this is NEXT_PUBLIC_DASHBOARD_URL (see fallbackAuthUrl).
    BETTER_AUTH_URL: z.string().url(),
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
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET,
    BETTER_AUTH_URL: process.env.BETTER_AUTH_URL || fallbackAuthUrl(),
    GOOGLE_CLIENT_ID: process.env.GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET: process.env.GOOGLE_CLIENT_SECRET,
    MICROSOFT_CLIENT_ID: process.env.MICROSOFT_CLIENT_ID,
    MICROSOFT_CLIENT_SECRET: process.env.MICROSOFT_CLIENT_SECRET,
    MICROSOFT_TENANT_ID: process.env.MICROSOFT_TENANT_ID,
  });
}
