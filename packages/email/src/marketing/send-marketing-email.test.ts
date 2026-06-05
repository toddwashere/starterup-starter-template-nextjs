import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockSendEmail } = vi.hoisted(() => ({
  mockSendEmail: vi.fn().mockResolvedValue({ id: "msg_abc123" }),
}));

vi.mock("../provider/index", () => ({
  EmailProvider: { sendEmail: mockSendEmail },
}));

vi.mock("../../keys", () => ({
  keys: vi.fn(),
}));

import { keys } from "../../keys";
import { sendMarketingEmail } from "./send-marketing-email";

describe("sendMarketingEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSendEmail.mockResolvedValue({ id: "msg_abc123" });
    vi.mocked(keys).mockReturnValue({
      RESEND_API_KEY: "re_test_key",
      EMAIL_FROM: "Test <noreply@test.com>",
      EMAIL_PROVIDER: "resend",
    });
  });

  const baseInput = {
    contentSource: "registry" as const,
    recipient: "jane@example.com",
    subjectTemplate: "Hello {{firstName}}",
    templateKey: "nurture-intro" as const,
    templateProps: {
      bodyIntro: "Welcome to our newsletter.",
      ctaUrl: "https://example.com/start",
      ctaLabel: "Get started",
    },
    organizationName: "Acme Corp",
    mergeData: { firstName: "Jane" },
    unsubscribeUrl: "https://www.example.com/email/preferences?token=abc",
    oneClickUnsubscribeUrl:
      "https://www.example.com/email/preferences/one-click?token=abc",
    buildClickRedirectUrl: (url: string) =>
      `https://www.example.com/email/go/tok?dest=${encodeURIComponent(url)}`,
    metadata: {
      stepSendId: "esend_1",
      enrollmentId: "eenrl_1",
      sequenceId: "eseq_1",
      organizationId: "org_1",
    },
  };

  it("rewrites links, sets List-Unsubscribe headers, and attaches metadata tags", async () => {
    await sendMarketingEmail(baseInput);

    expect(mockSendEmail).toHaveBeenCalledOnce();
    const payload = mockSendEmail.mock.calls[0]![0];

    expect(payload.subject).toBe("Hello Jane");
    expect(payload.html).toContain("/email/go/tok");
    expect(payload.html).not.toContain('href="https://example.com/start"');
    expect(payload.headers).toEqual({
      "List-Unsubscribe": `<${baseInput.oneClickUnsubscribeUrl}>`,
      "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
    });
    expect(payload.metadata).toEqual(baseInput.metadata);
    expect(payload.html).toContain("Unsubscribe");
    expect(payload.html).toContain("123 Example Street");
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

    it("logs and does not call provider", async () => {
      await expect(sendMarketingEmail(baseInput)).resolves.toEqual({});
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining("jane@example.com"),
      );
      expect(mockSendEmail).not.toHaveBeenCalled();
    });
  });
});
