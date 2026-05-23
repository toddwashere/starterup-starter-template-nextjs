import { keys } from "../keys";
import { renderEmail } from "./render";
import { EmailProvider } from "./provider/index";
import { SubscriptionCanceledEmail } from "./templates/subscription-canceled-email";

export interface SendSubscriptionCanceledEmailInput {
  recipient: string;
  organizationName: string;
  planName: string;
  accessEndsAt?: string;
}

export async function sendSubscriptionCanceledEmail(
  input: SendSubscriptionCanceledEmailInput,
): Promise<void> {
  const { RESEND_API_KEY } = keys();
  if (!RESEND_API_KEY) {
    console.log(
      `[Email] Subscription canceled for ${input.recipient}: ${input.organizationName} ${input.planName} plan canceled${input.accessEndsAt ? `, access ends ${input.accessEndsAt}` : ""}`,
    );
    return;
  }

  const { html, text } = await renderEmail(
    SubscriptionCanceledEmail({
      organizationName: input.organizationName,
      planName: input.planName,
      accessEndsAt: input.accessEndsAt,
    }),
  );

  await EmailProvider.sendEmail({
    recipient: input.recipient,
    subject: `Your ${input.planName} subscription has been canceled`,
    html,
    text,
  });
}
