import { Button, Hr, Text } from "@react-email/components";
import { EmailLayout } from "./_components/email-layout";

export interface PaymentFailedEmailProps {
  organizationName: string;
  updatePaymentUrl?: string;
}

export function PaymentFailedEmail({
  organizationName,
  updatePaymentUrl,
}: PaymentFailedEmailProps) {
  return (
    <EmailLayout
      preview={`Action required: payment failed for ${organizationName}.`}
    >
      <Text
        style={{ fontSize: "24px", fontWeight: "bold", color: "#000", margin: "0 0 8px" }}
      >
        Payment failed
      </Text>
      <Text style={{ color: "#444", margin: "0 0 24px" }}>
        We were unable to process the payment for <strong>{organizationName}</strong>. Please
        update your payment method to avoid any interruption to your service.
      </Text>
      {updatePaymentUrl ? (
        <>
          <Button
            href={updatePaymentUrl}
            style={{
              display: "block",
              backgroundColor: "#000",
              color: "#fff",
              padding: "12px 24px",
              borderRadius: "4px",
              fontWeight: "bold",
              textDecoration: "none",
              textAlign: "center",
              marginBottom: "24px",
            }}
          >
            Update Payment Method
          </Button>
          <Text style={{ color: "#888", fontSize: "12px", margin: "0 0 24px" }}>
            Or copy and paste this URL into your browser: {updatePaymentUrl}
          </Text>
        </>
      ) : null}
      <Hr style={{ borderColor: "#eaeaea", margin: "0 0 24px" }} />
      <Text style={{ color: "#888", fontSize: "12px", margin: "0" }}>
        If you need assistance, reply to this email and our support team will help you.
      </Text>
    </EmailLayout>
  );
}
