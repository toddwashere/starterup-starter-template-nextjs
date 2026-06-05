import { describe, expect, it } from "vitest";
import {
  createInertEmailPreviewHtml,
  sortStepsByDelay,
} from "./sequence-step-preview-list-utils";

describe("createInertEmailPreviewHtml", () => {
  it("wraps preview html so links and scrolling are disabled", () => {
    const html = createInertEmailPreviewHtml('<p>Hello</p><a href="https://example.com">Open</a>');

    expect(html).toContain("overflow: hidden");
    expect(html).toContain("pointer-events: none");
    expect(html).toContain("tabindex=\"-1\"");
    expect(html).toContain("href=\"#\"");
    expect(html).toContain("<p>Hello</p>");
  });
});

describe("sortStepsByDelay", () => {
  it("orders steps by delay from immediate to largest delay", () => {
    const steps = [
      { id: "five-days", delayMinutes: 7200 },
      { id: "immediate", delayMinutes: 0 },
      { id: "three-days", delayMinutes: 4320 },
    ];

    expect(sortStepsByDelay(steps).map((step) => step.id)).toEqual([
      "immediate",
      "three-days",
      "five-days",
    ]);
  });
});
