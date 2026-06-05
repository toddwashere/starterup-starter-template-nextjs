import { describe, expect, it } from "vitest";

import { applyMergeFields } from "./merge-fields";

describe("applyMergeFields", () => {
  it("replaces known fields", () => {
    const result = applyMergeFields("Hi {{firstName}} from {{organizationName}}", {
      firstName: "Ada",
      organizationName: "Acme",
    });

    expect(result).toBe("Hi Ada from Acme");
  });

  it("uses empty string for missing values", () => {
    const result = applyMergeFields("Hello {{firstName}} {{lastName}}", {
      firstName: "Ada",
    });

    expect(result).toBe("Hello Ada ");
  });

  it("does not evaluate arbitrary expressions", () => {
    const result = applyMergeFields("{{unknown}} {{firstName}}", {
      firstName: "Ada",
    });

    expect(result).toBe("{{unknown}} Ada");
  });
});
