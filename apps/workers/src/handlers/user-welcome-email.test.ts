import { beforeEach, describe, expect, it, vi } from "vitest";

import { prisma } from "@workspace/database";
import { sendWelcomeEmail } from "@workspace/email/send-welcome-email";

import { handleUserWelcomeEmail } from "./user-welcome-email";

vi.mock("@workspace/database", () => ({
  prisma: { user: { findUnique: vi.fn() } },
}));
vi.mock("@workspace/email/send-welcome-email", () => ({
  sendWelcomeEmail: vi.fn(),
}));

const findUnique = vi.mocked(prisma.user.findUnique);
const mockSendWelcomeEmail = vi.mocked(sendWelcomeEmail);

describe("handleUserWelcomeEmail", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("looks up the user by the payload userId", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      name: "Ada",
    } as never);

    await handleUserWelcomeEmail({ userId: "u1" });

    expect(findUnique).toHaveBeenCalledWith({ where: { id: "u1" } });
  });

  it("sends a welcome email exactly once for a found user", async () => {
    findUnique.mockResolvedValue({
      id: "u1",
      email: "user@example.com",
      name: "Ada",
    } as never);

    await handleUserWelcomeEmail({ userId: "u1" });

    expect(mockSendWelcomeEmail).toHaveBeenCalledTimes(1);
    const arg = mockSendWelcomeEmail.mock.calls[0]![0];
    expect(arg.recipient).toBe("user@example.com");
    expect(arg.name).toBe("Ada");
    expect(typeof arg.getStartedUrl).toBe("string");
    expect(arg.getStartedUrl.length).toBeGreaterThan(0);
  });

  it("does not send an email and resolves when the user is not found", async () => {
    findUnique.mockResolvedValue(null as never);

    await expect(
      handleUserWelcomeEmail({ userId: "missing" }),
    ).resolves.toBeUndefined();
    expect(mockSendWelcomeEmail).not.toHaveBeenCalled();
  });
});
