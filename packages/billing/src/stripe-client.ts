import Stripe from "stripe";
import { keys } from "../keys";

function createStripeClient() {
  const { STRIPE_SECRET_KEY } = keys();
  return new Stripe(STRIPE_SECRET_KEY);
}

export type StripeClient = InstanceType<typeof Stripe>;

let client: StripeClient | null = null;

export function getStripeClient(): StripeClient {
  if (!client) {
    client = createStripeClient();
  }
  return client;
}
