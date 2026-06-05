import { Section } from "@react-email/components";

/** Embeds editor-exported HTML inside the marketing document shell. */
export function MarketingEmailRawBody({ html }: { html: string }) {
  return <Section dangerouslySetInnerHTML={{ __html: html }} />;
}
