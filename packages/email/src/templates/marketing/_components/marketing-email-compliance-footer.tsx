import { Hr, Link, Text } from "@react-email/components";

export interface MarketingEmailComplianceFooterProps {
  organizationName: string;
  unsubscribeUrl: string;
  physicalAddress?: string;
}

/**
 * Developer-owned CAN-SPAM / unsubscribe block injected into every marketing email.
 * Do not expose this in the dashboard editor — it is appended at send time.
 */
export function MarketingEmailComplianceFooter({
  organizationName,
  unsubscribeUrl,
  physicalAddress = "123 Example Street, Example City, EX 12345",
}: MarketingEmailComplianceFooterProps) {
  return (
    <>
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
    </>
  );
}

export function marketingEmailCompliancePlainTextFooter(
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
