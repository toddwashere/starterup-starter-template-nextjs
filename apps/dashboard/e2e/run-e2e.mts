/**
 * E2E entrypoint — spawns Playwright with `e2e/playwright.config.ts`.
 *
 * Skip gate: set E2E_DISABLED=1 (or "true", case-insensitive) to skip the
 * entire suite without error.  Useful in CI pipelines that opt out of E2E.
 */

import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

// ---------------------------------------------------------------------------
// Skip gate — must run before spawning anything
// ---------------------------------------------------------------------------
const disabled = process.env.E2E_DISABLED;
if (disabled === "1" || disabled?.toLowerCase() === "true") {
  console.log("E2E skipped (E2E_DISABLED is set).");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// Resolve the dashboard app root from this file's location:
//   …/apps/dashboard/e2e/run-e2e.mts  →  dirname = …/apps/dashboard/e2e
//   one level up                        →  …/apps/dashboard
// ---------------------------------------------------------------------------
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appRoot = path.resolve(__dirname, "..");

// ---------------------------------------------------------------------------
// Forward extra args, stripping a leading standalone "--" separator.
// tsx passes the "--" token from scripts like `tsx run-e2e.mts -- --headed`
// through to process.argv, which would confuse Playwright. A "--" elsewhere
// is preserved (Playwright may use it to delimit positional args).
// ---------------------------------------------------------------------------
const extraArgs = process.argv.slice(2);
if (extraArgs[0] === "--") extraArgs.shift();

// ---------------------------------------------------------------------------
// Spawn Playwright via `pnpm exec` so the dashboard-local binary is used.
// stdio: "inherit" keeps colours and progress output intact.
// ---------------------------------------------------------------------------
const result = spawnSync(
  "pnpm",
  ["exec", "playwright", "test", "-c", "e2e/playwright.config.ts", ...extraArgs],
  { cwd: appRoot, stdio: "inherit" },
);

if (result.error) {
  console.error("Failed to spawn Playwright:", result.error);
  process.exit(1);
}

process.exit(result.status ?? 1);
