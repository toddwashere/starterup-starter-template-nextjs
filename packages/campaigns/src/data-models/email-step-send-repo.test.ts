import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    emailStepSend: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      groupBy: vi.fn(),
    },
    emailSequenceStep: { findMany: vi.fn() },
  },
}));

import { prisma } from "@workspace/database";
import {
  createEmailStepSend,
  findEmailStepSendByIdempotencyKey,
  markEmailStepSendSent,
} from "./email-step-send-repo";

beforeEach(() => vi.clearAllMocks());

describe("createEmailStepSend", () => {
  it("creates with esend prefix and idempotency key", async () => {
    vi.mocked(prisma.emailStepSend.create).mockResolvedValue({
      id: "esend_test",
      idempotencyKey: "eenrl_1:estep_1",
    } as never);

    await createEmailStepSend({
      enrollmentId: "eenrl_1",
      stepId: "estep_1",
      idempotencyKey: "eenrl_1:estep_1",
    });

    const call = vi.mocked(prisma.emailStepSend.create).mock.calls[0]?.[0];
    expect(call?.data.id).toMatch(/^esend_/);
    expect(call?.data.idempotencyKey).toBe("eenrl_1:estep_1");
  });
});

describe("findEmailStepSendByIdempotencyKey", () => {
  it("queries by unique idempotency key", async () => {
    vi.mocked(prisma.emailStepSend.findUnique).mockResolvedValue(null as never);
    await findEmailStepSendByIdempotencyKey("eenrl_1:estep_1");
    expect(prisma.emailStepSend.findUnique).toHaveBeenCalledWith({
      where: { idempotencyKey: "eenrl_1:estep_1" },
    });
  });
});

describe("markEmailStepSendSent", () => {
  it("updates status and providerMessageId", async () => {
    vi.mocked(prisma.emailStepSend.update).mockResolvedValue({} as never);
    await markEmailStepSendSent("esend_1", "msg_123");
    expect(prisma.emailStepSend.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "esend_1" },
        data: expect.objectContaining({
          status: "sent",
          providerMessageId: "msg_123",
        }),
      }),
    );
  });
});
