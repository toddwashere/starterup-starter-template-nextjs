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
import { sendInvitationEmail } from "./send-invitation-email";

describe("sendInvitationEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ id: "test-email-id" });
    vi.mocked(keys).mockReturnValue({
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "Test <noreply@test.com>",
      EMAIL_PROVIDER: "resend",
    });
  });

  it("calls provider with org name in subject", async () => {
    await sendInvitationEmail({
      recipient: "user@example.com",
      inviterName: "Bob",
      organizationName: "Acme Inc",
      acceptUrl: "https://app.example.com/accept-invitation/inv_123",
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "You've been invited to Acme Inc",
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
        sendInvitationEmail({
          recipient: "user@example.com",
          inviterName: "Bob",
          organizationName: "Acme Inc",
          acceptUrl: "https://example.com/accept-invitation/inv_123",
        }),
      ).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("user@example.com"),
      );
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });
});
