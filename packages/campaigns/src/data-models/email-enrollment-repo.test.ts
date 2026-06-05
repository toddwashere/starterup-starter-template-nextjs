import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    emailEnrollment: {
      create: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      groupBy: vi.fn(),
    },
    $transaction: vi.fn((ops: unknown[]) => Promise.all(ops as Promise<unknown>[])),
  },
}));

import { prisma } from "@workspace/database";
import {
  createEmailEnrollments,
  getActiveEnrollmentForContactAndSequence,
  exitActiveEnrollmentsForContact,
} from "./email-enrollment-repo";

beforeEach(() => vi.clearAllMocks());

describe("createEmailEnrollments", () => {
  it("returns empty array for no enrollments", async () => {
    const result = await createEmailEnrollments("org_1", []);
    expect(result).toEqual([]);
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

describe("getActiveEnrollmentForContactAndSequence", () => {
  it("scopes to organization and active status", async () => {
    vi.mocked(prisma.emailEnrollment.findFirst).mockResolvedValue(null as never);
    await getActiveEnrollmentForContactAndSequence("contact_1", "eseq_1", "org_1");
    expect(prisma.emailEnrollment.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contactId: "contact_1",
          sequenceId: "eseq_1",
          organizationId: "org_1",
          status: "active",
        },
      }),
    );
  });
});

describe("exitActiveEnrollmentsForContact", () => {
  it("exits all active enrollments when no sequenceId", async () => {
    vi.mocked(prisma.emailEnrollment.updateMany).mockResolvedValue({ count: 2 } as never);
    await exitActiveEnrollmentsForContact("contact_1", "org_1", "unsubscribed_all");
    expect(prisma.emailEnrollment.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          contactId: "contact_1",
          organizationId: "org_1",
          status: "active",
        },
        data: expect.objectContaining({ status: "exited", exitReason: "unsubscribed_all" }),
      }),
    );
  });
});
