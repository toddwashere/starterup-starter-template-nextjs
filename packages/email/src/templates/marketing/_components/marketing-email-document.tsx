import {
  Html,
  Head,
  Preview,
  Body,
  Container,
  Text,
} from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";
import type { ReactNode } from "react";
import {
  MarketingEmailComplianceFooter,
  type MarketingEmailComplianceFooterProps,
} from "./marketing-email-compliance-footer";

export interface MarketingEmailDocumentProps extends MarketingEmailComplianceFooterProps {
  preview: string;
  children: ReactNode;
}

/**
 * Full marketing email shell: preview, org header, user body, compliance footer.
 */
export function MarketingEmailDocument({
  preview,
  organizationName,
  unsubscribeUrl,
  physicalAddress,
  children,
}: MarketingEmailDocumentProps) {
  return (
    <Html>
      <Head />
      <Preview>{preview}</Preview>
      <Tailwind>
        <Body
          style={{
            backgroundColor: "#f5f5f5",
            fontFamily: "sans-serif",
            margin: "0",
            padding: "40px 0",
          }}
        >
          <Container
            style={{
              backgroundColor: "#ffffff",
              border: "1px solid #eaeaea",
              borderRadius: "8px",
              maxWidth: "465px",
              margin: "0 auto",
              padding: "40px",
            }}
          >
            <Text style={{ color: "#888", fontSize: "12px", margin: "0 0 24px" }}>
              {organizationName}
            </Text>
            {children}
            <MarketingEmailComplianceFooter
              organizationName={organizationName}
              unsubscribeUrl={unsubscribeUrl}
              physicalAddress={physicalAddress}
            />
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}
