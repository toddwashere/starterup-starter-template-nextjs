import { Hr, Text } from "@react-email/components";
import { EmailLayout } from "./_components/email-layout";

export interface SubscriptionCanceledEmailProps {
  organizationName: string;
  planName: string;
  accessEndsAt?: string;
}

export function SubscriptionCanceledEmail({
  organizationName,
  planName,
  accessEndsAt,
}: SubscriptionCanceledEmailProps) {
  return (
    <EmailLayout
      preview={`Your ${planName} subscription for ${organizationName} has been canceled.`}
    >
      <Text
        style={{ fontSize: "24px", fontWeight: "bold", color: "#000", margin: "0 0 8px" }}
      >
        Subscription canceled
      </Text>
      <Text style={{ color: "#444", margin: "0 0 24px" }}>
        The <strong>{planName}</strong> subscription for <strong>{organizationName}</strong> has
        been canceled.
        {accessEndsAt
          ? ` Your access will continue until ${accessEndsAt}.`
          : " Your access has ended."}
      </Text>
      <Hr style={{ borderColor: "#eaeaea", margin: "0 0 24px" }} />
      <Text style={{ color: "#888", fontSize: "12px", margin: "0" }}>
        If you canceled by mistake or have questions, reply to this email and we&apos;ll be happy
        to help.
      </Text>
    </EmailLayout>
  );
}
