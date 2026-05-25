import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, devices } from "@playwright/test";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Absolute path to the saved auth storage state.
 * Exported so auth.setup.ts and test files share one source of truth.
 */
export const STORAGE_STATE = path.join(__dirname, ".auth", "user.json");

/**
 * Repo root — three levels up from apps/dashboard/e2e/
 * Used as cwd for the webServer command so dotenv and pnpm filters resolve correctly.
 */
const repoRoot = path.resolve(__dirname, "../../..");

export default defineConfig({
  testDir: __dirname,
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.E2E_CI,
  retries: process.env.E2E_CI ? 2 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:4000",
    trace: process.env.E2E_CI ? "on-first-retry" : "off",
  },
  projects: [
    {
      name: "setup",
      testMatch: /auth\.setup\.ts/,
    },
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        storageState: STORAGE_STATE,
      },
      dependencies: ["setup"],
    },
  ],
  webServer: {
    command:
      "pnpm exec dotenv -e .env -- pnpm --filter @apps/dashboard exec next start --port 4000",
    cwd: repoRoot,
    url: "http://localhost:4000/sign-in",
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
