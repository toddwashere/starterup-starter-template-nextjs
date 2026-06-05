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
import { sendSubscriptionWelcomeEmail } from "./send-subscription-welcome-email";

describe("sendSubscriptionWelcomeEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ id: "test-email-id" });
    vi.mocked(keys).mockReturnValue({
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "Test <noreply@test.com>",
      EMAIL_PROVIDER: "resend",
    });
  });

  it("calls provider with org and plan in subject", async () => {
    await sendSubscriptionWelcomeEmail({
      recipient: "admin@acme.com",
      organizationName: "Acme Inc",
      planName: "Pro",
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Acme Inc is now on the Pro plan",
        html: expect.stringMatching(/.+/),
        text: expect.stringMatching(/.+/),
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
        sendSubscriptionWelcomeEmail({
          recipient: "admin@acme.com",
          organizationName: "Acme Inc",
          planName: "Pro",
        }),
      ).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("admin@acme.com"),
      );
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });
});
