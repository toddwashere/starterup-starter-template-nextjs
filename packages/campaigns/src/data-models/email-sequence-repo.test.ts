import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    emailSequence: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
    },
    emailSequenceStep: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

import { prisma } from "@workspace/database";
import {
  listEmailSequencesForOrg,
  getEmailSequenceById,
  createEmailSequence,
  createEmailSequenceStep,
  deleteEmailSequence,
  deleteEmailSequenceStep,
} from "./email-sequence-repo";

beforeEach(() => vi.clearAllMocks());

describe("listEmailSequencesForOrg", () => {
  it("scopes query to organizationId", async () => {
    vi.mocked(prisma.emailSequence.findMany).mockResolvedValue([] as never);
    await listEmailSequencesForOrg("org_1");
    expect(prisma.emailSequence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org_1" }),
      }),
    );
  });

  it("filters by kind when provided", async () => {
    vi.mocked(prisma.emailSequence.findMany).mockResolvedValue([] as never);
    await listEmailSequencesForOrg("org_1", "campaign");
    expect(prisma.emailSequence.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ organizationId: "org_1", kind: "campaign" }),
      }),
    );
  });
});

describe("getEmailSequenceById", () => {
  it("scopes query to organizationId", async () => {
    vi.mocked(prisma.emailSequence.findFirst).mockResolvedValue(null as never);
    await getEmailSequenceById("eseq_1", "org_1");
    expect(prisma.emailSequence.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "eseq_1", organizationId: "org_1" },
      }),
    );
  });
});

describe("createEmailSequence", () => {
  it("creates with eseq prefix id", async () => {
    vi.mocked(prisma.emailSequence.create).mockResolvedValue({
      id: "eseq_test",
      organizationId: "org_1",
      steps: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    } as never);

    await createEmailSequence("org_1", "user_1", {
      kind: "campaign",
      name: "Welcome",
      slug: "welcome",
    });

    const call = vi.mocked(prisma.emailSequence.create).mock.calls[0]?.[0];
    expect(call?.data.id).toMatch(/^eseq_/);
    expect(call?.data.organizationId).toBe("org_1");
  });
});

describe("createEmailSequenceStep", () => {
  it("throws when sequence is not in org", async () => {
    vi.mocked(prisma.emailSequence.findFirst).mockResolvedValue(null as never);
    await expect(
      createEmailSequenceStep("eseq_1", "org_1", {
        sortOrder: 0,
        delayMinutes: 0,
        templateKey: "nurture-intro",
        subjectTemplate: "Hi",
      }),
    ).rejects.toThrow("Sequence not found");
  });
});

describe("deleteEmailSequence", () => {
  it("deletes only within the organization", async () => {
    vi.mocked(prisma.emailSequence.delete).mockResolvedValue({ id: "eseq_1" } as never);
    await deleteEmailSequence("eseq_1", "org_1");
    expect(prisma.emailSequence.delete).toHaveBeenCalledWith({
      where: { id: "eseq_1", organizationId: "org_1" },
    });
  });
});

describe("deleteEmailSequenceStep", () => {
  it("throws when sequence is not in org", async () => {
    vi.mocked(prisma.emailSequence.findFirst).mockResolvedValue(null as never);
    await expect(deleteEmailSequenceStep("estep_1", "eseq_1", "org_1")).rejects.toThrow(
      "Sequence not found",
    );
  });

  it("deletes the step from the scoped sequence", async () => {
    vi.mocked(prisma.emailSequence.findFirst).mockResolvedValue({ id: "eseq_1" } as never);
    vi.mocked(prisma.emailSequenceStep.delete).mockResolvedValue({ id: "estep_1" } as never);
    await deleteEmailSequenceStep("estep_1", "eseq_1", "org_1");
    expect(prisma.emailSequenceStep.delete).toHaveBeenCalledWith({
      where: { id: "estep_1", sequenceId: "eseq_1" },
    });
  });
});
