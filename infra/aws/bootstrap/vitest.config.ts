import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    environment: "node",
    // Pulumi stack modules cache process.env at import time; keep files serial.
    fileParallelism: false,
  },
});

