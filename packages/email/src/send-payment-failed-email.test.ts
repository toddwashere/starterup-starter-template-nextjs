import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSendEmail } = vi.hoisted(() => ({
  mockSendEmail: vi.fn().mockResolvedValue({ id: "test-email-id" }),
}));

vi.mock("./provider/index", () => ({
  EmailProvider: { sendEmail: mockSendEmail },
}));

vi.mock("../keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "../keys";
import { sendPaymentFailedEmail } from "./send-payment-failed-email";

describe("sendPaymentFailedEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ id: "test-email-id" });
    vi.mocked(keys).mockReturnValue({
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "Test <noreply@test.com>",
      EMAIL_PROVIDER: "resend",
    });
  });

  it("calls provider with org in subject", async () => {
    await sendPaymentFailedEmail({
      recipient: "admin@acme.com",
      organizationName: "Acme Inc",
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Action required: payment failed for Acme Inc",
        html: expect.stringMatching(/.+/),
        text: expect.stringMatching(/.+/),
      }),
    );
  });

  it("includes update payment button when updatePaymentUrl is provided", async () => {
    await sendPaymentFailedEmail({
      recipient: "admin@acme.com",
      organizationName: "Acme Inc",
      updatePaymentUrl: "https://app.example.com/billing/payment",
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("https://app.example.com/billing/payment"),
      }),
    );
  });

  describe("without RESEND_API_KEY", () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.mocked(keys).mockReturnValue({
        RESEND_API_KEY: undefined,
        EMAIL_FROM: "App <noreply@example.com>",
      EMAIL_PROVIDER: "resend",
      });
      consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it("logs and does not throw", async () => {
      await expect(
        sendPaymentFailedEmail({
          recipient: "admin@acme.com",
          organizationName: "Acme Inc",
        }),
      ).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("admin@acme.com"),
      );
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });
});
