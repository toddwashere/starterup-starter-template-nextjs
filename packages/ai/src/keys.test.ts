import { afterEach, describe, expect, it, vi } from "vitest";
import { keys } from "../keys";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("keys() numeric env handling", () => {
  it("defaults AI_AGENT_MAX_STEPS to 5 when unset", () => {
    expect(keys().AI_AGENT_MAX_STEPS).toBe(5);
  });

  it("treats a blank AI_AGENT_MAX_STEPS as unset (default 5, not 0)", () => {
    vi.stubEnv("AI_AGENT_MAX_STEPS", "");
    expect(keys().AI_AGENT_MAX_STEPS).toBe(5);
  });

  it("parses an explicit AI_AGENT_MAX_STEPS", () => {
    vi.stubEnv("AI_AGENT_MAX_STEPS", "3");
    expect(keys().AI_AGENT_MAX_STEPS).toBe(3);
  });

  it("treats a blank AI_TEMPERATURE as undefined (not 0)", () => {
    vi.stubEnv("AI_TEMPERATURE", "");
    expect(keys().AI_TEMPERATURE).toBeUndefined();
  });

  it("parses an explicit AI_TEMPERATURE (including 0)", () => {
    vi.stubEnv("AI_TEMPERATURE", "0");
    expect(keys().AI_TEMPERATURE).toBe(0);
  });

  it("treats a blank AI_MAX_OUTPUT_TOKENS as undefined (not 0)", () => {
    vi.stubEnv("AI_MAX_OUTPUT_TOKENS", "");
    expect(keys().AI_MAX_OUTPUT_TOKENS).toBeUndefined();
  });
});
