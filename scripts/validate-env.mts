import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

config({ path: path.join(root, ".env.example"), override: true });

type Validator = { name: string; validate: () => Promise<unknown> };

const validators: Validator[] = [
  { name: "@workspace/worker-queue", validate: async () => (await import("../packages/worker-queue/keys.ts")).keys() },
  { name: "@workspace/ai", validate: async () => (await import("../packages/ai/keys.ts")).keys() },
  { name: "@workspace/email", validate: async () => (await import("../packages/email/keys.ts")).keys() },
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
