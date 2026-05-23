import { describe, expect, it } from "vitest";
import { renderPrompt } from "./render-prompt";

describe("renderPrompt()", () => {
  it("substitutes a simple variable", () => {
    expect(renderPrompt("Hello {{orgName}}", { orgName: "Acme" })).toBe(
      "Hello Acme",
    );
  });

  it("omits an optional section when its variable is absent", () => {
    const template = "Intro.{{#toolSummary}}\nTools:\n{{toolSummary}}{{/toolSummary}}";
    expect(renderPrompt(template, {})).toBe("Intro.");
  });

  it("renders a section and its body when the variable is provided", () => {
    const template = "Intro.{{#toolSummary}}\nTools:\n{{toolSummary}}{{/toolSummary}}";
    expect(renderPrompt(template, { toolSummary: "- a" })).toBe(
      "Intro.\nTools:\n- a",
    );
  });

  it("does not HTML-escape values (prompts are not HTML)", () => {
    expect(renderPrompt("{{orgName}}", { orgName: "A & B <co>" })).toBe(
      "A & B <co>",
    );
  });

  it("throws when the rendered output still contains a placeholder", () => {
    // A value that injects an unrendered placeholder leaves `{{` behind.
    expect(() =>
      renderPrompt("Hi {{greeting}}", { greeting: "{{name}}" }),
    ).toThrow(/unresolved|placeholder/i);
  });
});
