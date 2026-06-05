import { Button, Text } from "@react-email/components";
import { MarketingEmailLayout } from "./_components/marketing-email-layout";

export interface NurtureIntroEmailProps {
  organizationName: string;
  bodyIntro: string;
  ctaUrl: string;
  ctaLabel: string;
  unsubscribeUrl: string;
  physicalAddress?: string;
}

export function NurtureIntroEmail({
  organizationName,
  bodyIntro,
  ctaUrl,
  ctaLabel,
  unsubscribeUrl,
  physicalAddress,
}: NurtureIntroEmailProps) {
  return (
    <MarketingEmailLayout
      preview={bodyIntro.slice(0, 100)}
      organizationName={organizationName}
      unsubscribeUrl={unsubscribeUrl}
      physicalAddress={physicalAddress}
    >
      <Text style={{ color: "#444", margin: "0 0 24px", lineHeight: "1.6" }}>{bodyIntro}</Text>
      <Button
        href={ctaUrl}
        style={{
          display: "block",
          backgroundColor: "#000",
          color: "#fff",
          padding: "12px 24px",
          borderRadius: "4px",
          fontWeight: "bold",
          textDecoration: "none",
          textAlign: "center",
        }}
      >
        {ctaLabel}
      </Button>
    </MarketingEmailLayout>
  );
}
