import { Button, Text } from "@react-email/components";
import { MarketingEmailDocument } from "./_components/marketing-email-document";

export interface NurtureIntroEmailBodyProps {
  bodyIntro: string;
  ctaUrl: string;
  ctaLabel: string;
}

/** User-editable body region only — compliance footer is injected at send time. */
export function NurtureIntroEmailBody({
  bodyIntro,
  ctaUrl,
  ctaLabel,
}: NurtureIntroEmailBodyProps) {
  return (
    <>
      <Text style={{ color: "#444", margin: "0 0 24px", lineHeight: "1.6" }}>
        {bodyIntro}
      </Text>
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
    </>
  );
}

/** Full preview wrapper for email-preview app (includes compliance footer). */
export function NurtureIntroEmail({
  organizationName,
  bodyIntro,
  ctaUrl,
  ctaLabel,
  unsubscribeUrl,
  physicalAddress,
}: NurtureIntroEmailBodyProps & {
  organizationName: string;
  unsubscribeUrl: string;
  physicalAddress?: string;
}) {
  return (
    <MarketingEmailDocument
      preview={bodyIntro.slice(0, 100)}
      organizationName={organizationName}
      unsubscribeUrl={unsubscribeUrl}
      physicalAddress={physicalAddress}
    >
      <NurtureIntroEmailBody bodyIntro={bodyIntro} ctaUrl={ctaUrl} ctaLabel={ctaLabel} />
    </MarketingEmailDocument>
  );
}
