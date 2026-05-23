import { describe, expect, it } from "vitest";
import { groupProviderModelOptions } from "./ai-provider-model-select-utils";

describe("groupProviderModelOptions()", () => {
  it("groups options by groupLabel, preserving order", () => {
    const grouped = groupProviderModelOptions([
      { value: "openrouter:a", label: "A", groupLabel: "OpenRouter" },
      { value: "openrouter:b", label: "B", groupLabel: "OpenRouter" },
      { value: "anthropic:c", label: "C", groupLabel: "Anthropic" },
    ]);

    expect(grouped).toEqual([
      {
        groupLabel: "OpenRouter",
        options: [
          { value: "openrouter:a", label: "A" },
          { value: "openrouter:b", label: "B" },
        ],
      },
      {
        groupLabel: "Anthropic",
        options: [{ value: "anthropic:c", label: "C" }],
      },
    ]);
  });

  it("keeps a group's first-seen position even if entries are interleaved", () => {
    const grouped = groupProviderModelOptions([
      { value: "openrouter:a", label: "A", groupLabel: "OpenRouter" },
      { value: "anthropic:c", label: "C", groupLabel: "Anthropic" },
      { value: "openrouter:b", label: "B", groupLabel: "OpenRouter" },
    ]);

    expect(grouped.map((g) => g.groupLabel)).toEqual(["OpenRouter", "Anthropic"]);
    expect(grouped[0]?.options.map((o) => o.value)).toEqual([
      "openrouter:a",
      "openrouter:b",
    ]);
  });

  it("returns an empty array for no options", () => {
    expect(groupProviderModelOptions([])).toEqual([]);
  });
});
