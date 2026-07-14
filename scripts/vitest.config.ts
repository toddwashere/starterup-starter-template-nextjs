import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "scripts/**/*.test.ts",
      "infra/shared/**/*.test.ts",
      "infra/scripts/**/*.test.ts",
      "infra/aws/scripts/**/*.test.ts",
    ],
  },
});
