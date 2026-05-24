import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Load .env.example values for validation; override ensures the script validates
// example values, not accidentally-set process env vars from a local .env.
config({ path: path.join(root, ".env.example"), override: true });

type Validator = { name: string; validate: () => Promise<unknown> };

const validators: Validator[] = [
  { name: "@workspace/database", validate: async () => (await import("../packages/database/keys.ts")).keys() },
  { name: "@workspace/auth", validate: async () => (await import("../packages/auth/keys.ts")).keys() },
  { name: "@workspace/billing", validate: async () => (await import("../packages/billing/keys.ts")).keys() },
  { name: "@workspace/worker-queue", validate: async () => (await import("../packages/worker-queue/keys.ts")).keys() },
  { name: "@workspace/ai", validate: async () => (await import("../packages/ai/keys.ts")).keys() },
  { name: "@workspace/email", validate: async () => (await import("../packages/email/keys.ts")).keys() },
  { name: "apps/dashboard", validate: async () => (await import("../apps/dashboard/keys.ts")).keys() },
  { name: "apps/www", validate: async () => (await import("../apps/www/keys.ts")).keys() },
  { name: "apps/public-api", validate: async () => (await import("../apps/public-api/keys.ts")).keys() },
  { name: "apps/public-mcp", validate: async () => (await import("../apps/public-mcp/keys.ts")).keys() },
  { name: "apps/workers", validate: async () => (await import("../apps/workers/keys.ts")).keys() },
  { name: "apps/email-preview", validate: async () => (await import("../apps/email-preview/keys.ts")).keys() },
];

let failed = false;

for (const { name, validate } of validators) {
  try {
    await validate();
    console.log(`✓ ${name}`);
  } catch (error) {
    failed = true;
    console.error(`✗ ${name}`);
    console.error(error);
  }
}

process.exit(failed ? 1 : 0);
