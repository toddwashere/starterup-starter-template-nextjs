import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SECRET = "a".repeat(32);

vi.mock("../keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "../keys";
import { signMarketingToken, verifyMarketingToken } from "./marketing-token";

describe("marketing-token", () => {
  beforeEach(() => {
    vi.mocked(keys).mockReturnValue({ CAMPAIGN_UNSUBSCRIBE_SECRET: TEST_SECRET, NEXT_PUBLIC_WWW_URL: "http://localhost:4001" });
  });

  const basePayload = {
    contactId: "contact_1",
    organizationId: "org_1",
    scope: "all" as const,
  };

  it("round-trips a valid token", () => {
    const token = signMarketingToken(basePayload);
    const verified = verifyMarketingToken(token);
    expect(verified.contactId).toBe("contact_1");
    expect(verified.organizationId).toBe("org_1");
    expect(verified.scope).toBe("all");
    expect(verified.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("rejects tampered signature", () => {
    const token = signMarketingToken(basePayload);
    const [body] = token.split(".");
    expect(() => verifyMarketingToken(`${body}.tampered`)).toThrow(
      "Invalid token signature",
    );
  });

  it("rejects expired token", () => {
    vi.useFakeTimers();
    const token = signMarketingToken(basePayload, 0);
    vi.advanceTimersByTime(1000);
    expect(() => verifyMarketingToken(token)).toThrow("Token expired");
    vi.useRealTimers();
  });

  it("throws when secret is not configured", () => {
    vi.mocked(keys).mockReturnValue({ CAMPAIGN_UNSUBSCRIBE_SECRET: undefined, NEXT_PUBLIC_WWW_URL: "http://localhost:4001" });
    expect(() => signMarketingToken(basePayload)).toThrow(
      "CAMPAIGN_UNSUBSCRIBE_SECRET is not configured",
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });
});
