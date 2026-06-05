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
import { sendWelcomeEmail } from "./send-welcome-email";

describe("sendWelcomeEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ id: "test-email-id" });
    vi.mocked(keys).mockReturnValue({
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "Test <noreply@test.com>",
      EMAIL_PROVIDER: "resend",
    });
  });

  it("calls provider with correct subject", async () => {
    await sendWelcomeEmail({
      recipient: "user@example.com",
      name: "Jane",
      getStartedUrl: "https://app.example.com/dashboard",
    });

    expect(mockSendEmail).toHaveBeenCalledOnce();
    expect(mockSendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        subject: "Welcome!",
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
        sendWelcomeEmail({
          recipient: "user@example.com",
          name: "Jane",
          getStartedUrl: "https://example.com/dashboard",
        }),
      ).resolves.toBeUndefined();
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("user@example.com"),
      );
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });
});
