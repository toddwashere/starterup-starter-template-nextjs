import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["naming.test.ts", "scripts/**/*.test.ts"],
    environment: "node",
  },
});
