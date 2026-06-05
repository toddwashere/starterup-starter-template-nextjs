import { describe, expect, it } from "vitest";
import { createInertEmailPreviewHtml } from "./sequence-step-preview-list-utils";

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
