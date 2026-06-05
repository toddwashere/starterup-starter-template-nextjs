import type { ReactNode } from "react";
import {
  MarketingEmailDocument,
  type MarketingEmailDocumentProps,
} from "./marketing-email-document";

/**
 * @deprecated Prefer MarketingEmailDocument + assembleMarketingEmail for new templates.
 * Kept for email-preview and backward compatibility.
 */
interface MarketingEmailLayoutProps extends MarketingEmailDocumentProps {
  children: ReactNode;
}

export function MarketingEmailLayout(props: MarketingEmailLayoutProps) {
  return <MarketingEmailDocument {...props} />;
}

export { marketingEmailCompliancePlainTextFooter as marketingEmailPlainTextFooter } from "./marketing-email-compliance-footer";
