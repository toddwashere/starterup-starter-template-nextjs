import { keys } from "../../keys";
import { EmailProvider } from "../provider/index";
import { applyMergeFields, type MergeFieldData } from "./merge-fields";
import { rewriteLinksForTracking } from "./rewrite-links";
import { buildListUnsubscribeHeaders } from "./list-unsubscribe-headers";
import {
  marketingTemplateRegistry,
  type MarketingTemplateKey,
} from "./marketing-template-registry";
import {
  assembleMarketingEmail,
  assembleMarketingEmailFromEditorHtml,
} from "./assemble-marketing-email";

export type SendMarketingEmailInput = {
  recipient: string;
  subjectTemplate: string;
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
} & (
  | {
      contentSource: "registry";
      templateKey: MarketingTemplateKey;
      templateProps: Record<string, unknown>;
    }
  | {
      contentSource: "editor";
      previewText: string;
      bodyHtml: string;
      bodyText: string;
    }
);

export async function sendMarketingEmail(
  input: SendMarketingEmailInput,
): Promise<{ providerMessageId?: string }> {
  const { RESEND_API_KEY } = keys();
  if (!RESEND_API_KEY) {
    const label =
      input.contentSource === "registry"
        ? input.templateKey
        : "editor";
    console.log(
      `[Email] Marketing email for ${input.recipient} (content: ${label})`,
    );
    return {};
  }

  const subject = applyMergeFields(input.subjectTemplate, input.mergeData);

  let rawHtml: string;
  let rawText: string;

  if (input.contentSource === "registry") {
    const entry = marketingTemplateRegistry[input.templateKey];
    const validatedProps = entry.propsSchema.parse(input.templateProps);
    const preview =
      entry.previewFromProps?.(validatedProps as never) ?? subject.slice(0, 100);
    const body = entry.renderBody(validatedProps as never);
    const assembled = await assembleMarketingEmail({
      preview,
      organizationName: input.organizationName,
      unsubscribeUrl: input.unsubscribeUrl,
      physicalAddress: input.physicalAddress,
      body,
    });
    rawHtml = assembled.html;
    rawText = assembled.text;
  } else {
    const preview = applyMergeFields(input.previewText, input.mergeData);
    const assembled = await assembleMarketingEmailFromEditorHtml({
      preview,
      organizationName: input.organizationName,
      unsubscribeUrl: input.unsubscribeUrl,
      physicalAddress: input.physicalAddress,
      bodyHtml: applyMergeFields(input.bodyHtml, input.mergeData),
      bodyText: applyMergeFields(input.bodyText, input.mergeData),
    });
    rawHtml = assembled.html;
    rawText = assembled.text;
  }

  const html = rewriteLinksForTracking(rawHtml, input.buildClickRedirectUrl);
  const text = rewriteLinksForTracking(rawText, input.buildClickRedirectUrl);

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
