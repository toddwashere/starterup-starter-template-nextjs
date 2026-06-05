import { Html, Head, Preview, Body, Container, Text, Link, Hr } from "@react-email/components";
import { Tailwind } from "@react-email/tailwind";
import type { ReactNode } from "react";

interface MarketingEmailLayoutProps {
  preview: string;
  organizationName: string;
  unsubscribeUrl: string;
  physicalAddress?: string;
  children: ReactNode;
}

export function MarketingEmailLayout({
  preview,
  organizationName,
  unsubscribeUrl,
  physicalAddress = "123 Example Street, Example City, EX 12345",
  children,
}: MarketingEmailLayoutProps) {
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
            <Hr style={{ borderColor: "#eaeaea", margin: "24px 0" }} />
            <Text style={{ color: "#888", fontSize: "12px", margin: "0 0 8px" }}>
              {physicalAddress}
            </Text>
            <Text style={{ color: "#888", fontSize: "12px", margin: "0" }}>
              <Link href={unsubscribeUrl} style={{ color: "#888", textDecoration: "underline" }}>
                Unsubscribe
              </Link>
              {" · "}
              You received this email because you are subscribed to updates from {organizationName}.
            </Text>
          </Container>
        </Body>
      </Tailwind>
    </Html>
  );
}

export function marketingEmailPlainTextFooter(
  organizationName: string,
  unsubscribeUrl: string,
  physicalAddress = "123 Example Street, Example City, EX 12345",
): string {
  return [
    "",
    "---",
    organizationName,
    physicalAddress,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");
}
