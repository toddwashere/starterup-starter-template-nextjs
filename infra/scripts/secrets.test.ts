import { describe, it, expect } from "vitest";
import { parseSecretsArgs } from "./secrets";

describe("parseSecretsArgs", () => {
  it("defaults env to sandbox for status", () => {
    expect(parseSecretsArgs(["status"])).toEqual({
      command: "status",
      env: "sandbox",
      strict: false,
    });
  });

  it("parses set with env and secret id", () => {
    expect(parseSecretsArgs(["set", "stripe-secret-key", "--env", "staging"])).toEqual({
      command: "set",
      env: "staging",
      secretArg: "stripe-secret-key",
      fromEnv: undefined,
      strict: false,
    });
  });

  it("parses --from-env and --strict", () => {
    expect(
      parseSecretsArgs([
        "set",
        "STRIPE_SECRET_KEY",
        "--env=production",
        "--from-env",
        "STRIPE_SECRET_KEY",
      ]),
    ).toMatchObject({
      command: "set",
      env: "production",
      secretArg: "STRIPE_SECRET_KEY",
      fromEnv: "STRIPE_SECRET_KEY",
    });

    expect(parseSecretsArgs(["status", "--strict", "--env", "sandbox"]).strict).toBe(true);
  });

  it("rejects set without secret id", () => {
    expect(() => parseSecretsArgs(["set", "--env", "sandbox"])).toThrow(/requires a secret id/);
  });

  it("rejects invalid env", () => {
    expect(() => parseSecretsArgs(["status", "--env", "dev"])).toThrow(/Invalid --env/);
  });
});
