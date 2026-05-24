import { describe, it, expect, afterEach } from "vitest";
import { keys } from "./keys";

describe("billing keys", () => {
  const snapshot = { ...process.env };

  afterEach(() => {
    process.env = { ...snapshot };
  });

  it("accepts placeholder Stripe keys from .env.example shape", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_xxxxxxxx";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_xxxxxxxx";
    expect(keys().STRIPE_SECRET_KEY).toMatch(/^sk_test_/);
  });

  it("allows optional STRIPE_PRICE_* overrides to be unset", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_xxxxxxxx";
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_xxxxxxxx";
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
    expect(keys().STRIPE_PRICE_PRO_MONTHLY).toBeUndefined();
  });

  it("throws when STRIPE_SECRET_KEY is missing", () => {
    delete process.env.STRIPE_SECRET_KEY;
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_xxxxxxxx";
    expect(() => keys()).toThrow();
  });

  it("throws when STRIPE_WEBHOOK_SECRET is missing", () => {
    process.env.STRIPE_SECRET_KEY = "sk_test_xxxxxxxx";
    delete process.env.STRIPE_WEBHOOK_SECRET;
    expect(() => keys()).toThrow();
  });
});
