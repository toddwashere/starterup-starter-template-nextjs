import { describe, it, expect } from "vitest";
import { parseConfigureArgs } from "./parse-configure-args";

describe("parseConfigureArgs", () => {
  it("defaults env to sandbox", () => {
    expect(parseConfigureArgs([])).toEqual({ env: "sandbox", printResolved: false });
  });

  it("parses env and print-resolved", () => {
    expect(parseConfigureArgs(["--env", "staging", "--print-resolved"])).toEqual({
      env: "staging",
      printResolved: true,
    });
  });

  it("rejects invalid env", () => {
    expect(() => parseConfigureArgs(["--env", "qa"])).toThrow(/Invalid --env/);
  });
});
