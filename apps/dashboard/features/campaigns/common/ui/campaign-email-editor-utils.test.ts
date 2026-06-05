import { describe, expect, it } from "vitest";
import { htmlToPlainText } from "./campaign-email-editor-utils";

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
