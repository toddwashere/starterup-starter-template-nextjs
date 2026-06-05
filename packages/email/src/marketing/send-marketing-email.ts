import { keys } from "../../keys";
import { renderEmail } from "../render";
import { EmailProvider } from "../provider/index";
import { applyMergeFields, type MergeFieldData } from "./merge-fields";
import { rewriteLinksForTracking } from "./rewrite-links";
import { buildListUnsubscribeHeaders } from "./list-unsubscribe-headers";
import {
  marketingTemplateRegistry,
  type MarketingTemplateKey,
} from "./marketing-template-registry";
import { marketingEmailPlainTextFooter } from "../templates/marketing/_components/marketing-email-layout";

export type SendMarketingEmailInput = {
  recipient: string;
  subjectTemplate: string;
  templateKey: MarketingTemplateKey;
  templateProps: Record<string, unknown>;
  organizationName: string;
  mergeData: MergeFieldData;
  unsubscribeUrl: string;
  oneClickUnsubscribeUrl: string;
  buildClickRedirectUrl: (destinationUrl: string) => string;
  metadata: {
    stepSendId: string;
    enrollmentId: string;
    sequenceId: string;
    organizationId: string;
  };
  physicalAddress?: string;
};

export async function sendMarketingEmail(
  input: SendMarketingEmailInput,
): Promise<{ providerMessageId?: string }> {
  const { RESEND_API_KEY } = keys();
  if (!RESEND_API_KEY) {
    console.log(
      `[Email] Marketing email for ${input.recipient} (template: ${input.templateKey})`,
    );
    return {};
  }

  const entry = marketingTemplateRegistry[input.templateKey];
  const validatedProps = entry.propsSchema.parse(input.templateProps);

  const subject = applyMergeFields(input.subjectTemplate, input.mergeData);

  const { html: rawHtml, text: rawText } = await renderEmail(
    entry.component({
      organizationName: input.organizationName,
      unsubscribeUrl: input.unsubscribeUrl,
      physicalAddress: input.physicalAddress,
      ...validatedProps,
    }),
  );

  const html = rewriteLinksForTracking(rawHtml, input.buildClickRedirectUrl);
  const textBody = rewriteLinksForTracking(rawText, input.buildClickRedirectUrl);
  const text = `${textBody}${marketingEmailPlainTextFooter(
    input.organizationName,
    input.unsubscribeUrl,
    input.physicalAddress,
  )}`;

  const headers = buildListUnsubscribeHeaders(input.oneClickUnsubscribeUrl);

  const result = await EmailProvider.sendEmail({
    recipient: input.recipient,
    subject,
    html,
    text,
    headers,
    metadata: input.metadata,
  });

  return { providerMessageId: result.id };
}
