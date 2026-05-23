import { keys } from "../keys";
import { renderEmail } from "./render";
import { EmailProvider } from "./provider/index";
import { SubscriptionWelcomeEmail } from "./templates/subscription-welcome-email";

export interface SendSubscriptionWelcomeEmailInput {
  recipient: string;
  organizationName: string;
  planName: string;
}

export async function sendSubscriptionWelcomeEmail(
  input: SendSubscriptionWelcomeEmailInput,
): Promise<void> {
  const { RESEND_API_KEY } = keys();
  if (!RESEND_API_KEY) {
    console.log(
      `[Email] Subscription welcome for ${input.recipient}: ${input.organizationName} is now on the ${input.planName} plan`,
    );
    return;
  }

  const { html, text } = await renderEmail(
    SubscriptionWelcomeEmail({
      organizationName: input.organizationName,
      planName: input.planName,
    }),
  );

  await EmailProvider.sendEmail({
    recipient: input.recipient,
    subject: `${input.organizationName} is now on the ${input.planName} plan`,
    html,
    text,
  });
}
