import Stripe from "stripe";
import { keys } from "../keys";

let client: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!client) {
    const { STRIPE_SECRET_KEY } = keys();
    client = new Stripe(STRIPE_SECRET_KEY);
  }
  return client;
}
