import { defineConfig, configDefaults } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "happy-dom",
    setupFiles: ["./vitest.setup.ts"],
    // Exclude the Playwright E2E suite: its *.spec.ts files use Playwright's
    // runner, but Vitest's default `include` also matches *.spec.ts.
    exclude: [...configDefaults.exclude, "e2e/**"],
  },
  esbuild: {
    jsx: "automatic",
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "."),
    },
  },
});
