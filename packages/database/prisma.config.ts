import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { loadEnvFile } from "node:process";
import { fileURLToPath } from "node:url";
import { defineConfig, env } from "prisma/config";

const rootEnvPath = resolve(dirname(fileURLToPath(import.meta.url)), "../..", ".env");

if (existsSync(rootEnvPath)) {
  loadEnvFile(rootEnvPath);
}

export default defineConfig({
  schema: "prisma/",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env.DIRECT_URL ?? process.env.DATABASE_URL,
  },
});
