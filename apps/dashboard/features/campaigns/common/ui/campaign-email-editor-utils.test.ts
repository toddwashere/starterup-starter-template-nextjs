import { describe, expect, it } from "vitest";
import { getEditorBodyHtml, htmlToPlainText, toPlainJson } from "./campaign-email-editor-utils";

describe("htmlToPlainText", () => {
  it("converts simple email html into readable text", () => {
    expect(htmlToPlainText("<p>Hi there</p><p><a href=\"https://example.com\">Learn more</a></p>"))
      .toBe("Hi there\nLearn more");
  });

  it("drops script and style content", () => {
    expect(htmlToPlainText("<style>.x{}</style><p>Hello</p><script>alert(1)</script>"))
      .toBe("Hello");
  });
});

describe("getEditorBodyHtml", () => {
  it("keeps html fragments as-is", () => {
    expect(getEditorBodyHtml("<p>Hello</p>")).toBe("<p>Hello</p>");
  });

  it("extracts the body from a full html document", () => {
    expect(getEditorBodyHtml("<!doctype html><html><head></head><body><p>Hello</p></body></html>"))
      .toBe("<p>Hello</p>");
  });
});

describe("toPlainJson", () => {
  it("removes non-json fields before crossing server action boundaries", () => {
    const value = { type: "doc", fn: () => "nope", content: [{ type: "paragraph" }] };
    expect(toPlainJson(value)).toEqual({
      type: "doc",
      content: [{ type: "paragraph" }],
    });
  });
});
