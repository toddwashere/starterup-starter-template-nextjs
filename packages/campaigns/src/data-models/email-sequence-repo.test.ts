import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    emailSequence: {
      findMany: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    emailSequenceStep: {
      create: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "@workspace/database";
import {
  listEmailSequencesForOrg,
  getEmailSequenceById,
  createEmailSequence,
  createEmailSequenceStep,
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
