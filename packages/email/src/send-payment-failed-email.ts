import { keys } from "../keys";
import { renderEmail } from "./render";
import { EmailProvider } from "./provider/index";
import { PaymentFailedEmail } from "./templates/payment-failed-email";

export interface SendPaymentFailedEmailInput {
  recipient: string;
  organizationName: string;
  updatePaymentUrl?: string;
}

export async function sendPaymentFailedEmail(
  input: SendPaymentFailedEmailInput,
): Promise<void> {
  const { RESEND_API_KEY } = keys();
  if (!RESEND_API_KEY) {
    console.log(
      `[Email] Payment failed for ${input.recipient}: ${input.organizationName} payment could not be processed${input.updatePaymentUrl ? ` — update at ${input.updatePaymentUrl}` : ""}`,
    );
    return;
  }

  const { html, text } = await renderEmail(
    PaymentFailedEmail({
      organizationName: input.organizationName,
      updatePaymentUrl: input.updatePaymentUrl,
    }),
  );

  await EmailProvider.sendEmail({
    recipient: input.recipient,
    subject: `Action required: payment failed for ${input.organizationName}`,
    html,
    text,
  });
}
