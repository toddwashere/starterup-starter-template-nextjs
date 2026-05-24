import { describe, expect, it } from "vitest";
import { extractTemplateVars } from "./extract-template-vars";

describe("extractTemplateVars()", () => {
  it("extracts a simple variable", () => {
    expect(extractTemplateVars("Hello {{orgName}}")).toEqual(["orgName"]);
  });

  it("extracts a section name", () => {
    expect(
      extractTemplateVars("{{#toolSummary}}x{{/toolSummary}}"),
    ).toEqual(["toolSummary"]);
  });

  it("ignores Mustache comments", () => {
    expect(
      extractTemplateVars("{{! internal note }}Hi {{name}}"),
    ).toEqual(["name"]);
  });

  it("deduplicates repeated variables, preserving first-seen order", () => {
    expect(extractTemplateVars("{{a}} {{b}} {{a}}")).toEqual(["a", "b"]);
  });

  it("extracts both a variable and a section from a sample prompt", () => {
    const prompt = [
      "You are an assistant for {{orgName}}.",
      "{{#toolSummary}}",
      "Tools:",
      "{{toolSummary}}",
      "{{/toolSummary}}",
    ].join("\n");

    expect(extractTemplateVars(prompt)).toEqual(["orgName", "toolSummary"]);
  });

  it("returns an empty array when there are no placeholders", () => {
    expect(extractTemplateVars("plain text")).toEqual([]);
  });
});
