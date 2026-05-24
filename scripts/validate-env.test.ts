import { describe, it, expect } from "vitest";
import { execSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");

describe("validate-env CLI", () => {
  it("passes against the committed .env.example", () => {
    const output = execSync("pnpm validate:env", {
      cwd: root,
      encoding: "utf8",
      timeout: 30_000,
    });
    expect(output).toContain("✓");
  });
});
