import type { ReactElement } from "react";
import { renderEmail } from "../render";
import { MarketingEmailDocument } from "../templates/marketing/_components/marketing-email-document";
import { MarketingEmailRawBody } from "../templates/marketing/_components/marketing-email-raw-body";
import { marketingEmailCompliancePlainTextFooter } from "../templates/marketing/_components/marketing-email-compliance-footer";

export type AssembleMarketingEmailInput = {
  preview: string;
  organizationName: string;
  unsubscribeUrl: string;
  physicalAddress?: string;
  body: ReactElement;
};

export async function assembleMarketingEmail(
  input: AssembleMarketingEmailInput,
): Promise<{ html: string; text: string }> {
  const { html, text } = await renderEmail(
    <MarketingEmailDocument
      preview={input.preview}
      organizationName={input.organizationName}
      unsubscribeUrl={input.unsubscribeUrl}
      physicalAddress={input.physicalAddress}
    >
      {input.body}
    </MarketingEmailDocument>,
  );

  const textWithFooter = `${text}${marketingEmailCompliancePlainTextFooter(
    input.organizationName,
    input.unsubscribeUrl,
    input.physicalAddress,
  )}`;

  return { html, text: textWithFooter };
}

export type AssembleMarketingEmailFromHtmlInput = {
  preview: string;
  organizationName: string;
  unsubscribeUrl: string;
  physicalAddress?: string;
  /** HTML fragment from React Email Editor (user content only — no compliance footer). */
  bodyHtml: string;
  bodyText: string;
};

/**
 * Wrap editor-exported HTML in the developer-owned document shell and inject compliance footer.
 */
export async function assembleMarketingEmailFromEditorHtml(
  input: AssembleMarketingEmailFromHtmlInput,
): Promise<{ html: string; text: string }> {
  return assembleMarketingEmail({
    preview: input.preview,
    organizationName: input.organizationName,
    unsubscribeUrl: input.unsubscribeUrl,
    physicalAddress: input.physicalAddress,
    body: <MarketingEmailRawBody html={input.bodyHtml} />,
  }).then(({ html }) => ({
    html,
    text: `${input.bodyText}${marketingEmailCompliancePlainTextFooter(
      input.organizationName,
      input.unsubscribeUrl,
      input.physicalAddress,
    )}`,
  }));
}
