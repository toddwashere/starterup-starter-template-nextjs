import { describe, expect, it } from "vitest";
import { createId } from "@workspace/common";
import { creditsConfig } from "../credits.config";

describe("creditsConfig", () => {
  it("defaults to observe-only charging for starter template consumers", () => {
    expect(creditsConfig.policy.chargeToOrgDefault).toBe(false);
    expect(creditsConfig.policy.spendOrder).toEqual(["monthly_allowance", "wallet"]);
    expect(creditsConfig.policy.defaultMarkupBasisPoints).toBe(12_500);
  });

  it("uses integer pricing values and explicitly prices local models", () => {
    const ollama = creditsConfig.modelPricing.models["ollama:llama3.2"];

    expect(creditsConfig.modelPricing.version).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ollama.inputTokenWeight).toBe(0);
    expect(ollama.outputTokenWeight).toBe(0);
    expect(ollama.markupBasisPoints).toBe(10_000);
  });

  it("supports credit id prefixes", () => {
    expect(createId("credacct")).toMatch(/^credacct_/);
    expect(createId("creduse")).toMatch(/^creduse_/);
    expect(createId("credled")).toMatch(/^credled_/);
    expect(createId("credtopup")).toMatch(/^credtopup_/);
  });
});
