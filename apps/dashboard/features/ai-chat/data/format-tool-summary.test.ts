import { describe, expect, it } from "vitest";
import { formatToolSummary } from "./format-tool-summary";

describe("formatToolSummary()", () => {
  it("formats each tool as a bullet with its description", () => {
    expect(
      formatToolSummary([
        { name: "account-info", description: "Returns account info." },
        { name: "search", description: "Search records." },
      ]),
    ).toBe("- account-info: Returns account info.\n- search: Search records.");
  });

  it("omits the description when absent", () => {
    expect(formatToolSummary([{ name: "ping" }])).toBe("- ping");
  });

  it("skips malformed entries", () => {
    expect(
      formatToolSummary([{ name: "ok" }, null, "x", { description: "no name" }]),
    ).toBe("- ok");
  });

  it("returns undefined when there are no valid tools", () => {
    expect(formatToolSummary([])).toBeUndefined();
    expect(formatToolSummary([null, {}])).toBeUndefined();
  });
});
