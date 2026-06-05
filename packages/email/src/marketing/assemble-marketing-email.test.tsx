import { describe, expect, it } from "vitest";
import { assembleMarketingEmail } from "./assemble-marketing-email";
import { NurtureIntroEmailBody } from "../templates/marketing/nurture-intro-email";

describe("assembleMarketingEmail", () => {
  it("wraps body content with developer-owned compliance footer", async () => {
    const { html, text } = await assembleMarketingEmail({
      preview: "Preview line",
      organizationName: "Acme Corp",
      unsubscribeUrl: "https://www.example.com/email/preferences?token=abc",
      body: (
        <NurtureIntroEmailBody
          bodyIntro="Hello there"
          ctaUrl="https://example.com/go"
          ctaLabel="Go"
        />
      ),
    });

    expect(html).toContain("Hello there");
    expect(html).toContain("Unsubscribe");
    expect(html).toContain("123 Example Street");
    expect(html).toContain("Acme Corp");
    expect(text).toContain("Unsubscribe: https://www.example.com/email/preferences?token=abc");
  });
});
