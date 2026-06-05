import { describe, expect, it } from "vitest";

import { rewriteLinksForTracking } from "./rewrite-links";

describe("rewriteLinksForTracking", () => {
  it("rewrites http and https links", () => {
    const html =
      '<a href="https://example.com">Go</a> <a href="http://other.test/path">Other</a>';
    const result = rewriteLinksForTracking(html, (url) => `/track?to=${encodeURIComponent(url)}`);

    expect(result).toBe(
      '<a href="/track?to=https%3A%2F%2Fexample.com">Go</a> <a href="/track?to=http%3A%2F%2Fother.test%2Fpath">Other</a>',
    );
  });

  it("preserves mailto and tel links", () => {
    const html =
      '<a href="mailto:hi@example.com">Email</a> <a href="tel:+15551234567">Call</a>';
    const result = rewriteLinksForTracking(html, () => "/should-not-run");

    expect(result).toBe(html);
  });
});
