import { Hr, Text } from "@react-email/components";
import { EmailLayout } from "./_components/email-layout";

export interface SubscriptionWelcomeEmailProps {
  organizationName: string;
  planName: string;
}

export function SubscriptionWelcomeEmail({
  organizationName,
  planName,
}: SubscriptionWelcomeEmailProps) {
  return (
    <EmailLayout
      preview={`${organizationName} is now on the ${planName} plan.`}
    >
      <Text
        style={{ fontSize: "24px", fontWeight: "bold", color: "#000", margin: "0 0 8px" }}
      >
        Subscription confirmed!
      </Text>
      <Text style={{ color: "#444", margin: "0 0 24px" }}>
        <strong>{organizationName}</strong> is now on the <strong>{planName}</strong> plan.
        You&apos;re all set — your team can start using your new features right away.
      </Text>
      <Hr style={{ borderColor: "#eaeaea", margin: "0 0 24px" }} />
      <Text style={{ color: "#888", fontSize: "12px", margin: "0" }}>
        If you have questions about your subscription, reply to this email or contact support.
      </Text>
    </EmailLayout>
  );
}
