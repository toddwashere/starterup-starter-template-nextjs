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
import { sendSubscriptionCanceledEmail } from "./send-subscription-canceled-email";

describe("sendSubscriptionCanceledEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ id: "test-email-id" });
    vi.mocked(keys).mockReturnValue({
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "Test <noreply@test.com>",
    });
  });

  it("calls provider with plan in subject", async () => {
    await sendSubscriptionCanceledEmail({
      recipient: "admin@acme.com",
      organizationName: "Acme Inc",
      planName: "Pro",
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Your Pro subscription has been canceled",
        html: expect.stringMatching(/.+/),
        text: expect.stringMatching(/.+/),
      }),
    );
  });

  it("includes accessEndsAt in rendered email when provided", async () => {
    await sendSubscriptionCanceledEmail({
      recipient: "admin@acme.com",
      organizationName: "Acme Inc",
      planName: "Pro",
      accessEndsAt: "June 30, 2026",
    });

    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        html: expect.stringContaining("June 30, 2026"),
      }),
    );
  });

  describe("without RESEND_API_KEY", () => {
    let consoleSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      vi.mocked(keys).mockReturnValue({
        RESEND_API_KEY: undefined,
        EMAIL_FROM: "App <noreply@example.com>",
      });
      consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
      consoleSpy.mockRestore();
    });

    it("logs and does not throw", async () => {
      await expect(
        sendSubscriptionCanceledEmail({
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
