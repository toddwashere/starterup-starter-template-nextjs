import { prisma } from "@workspace/database";
import { createId } from "@workspace/common";
import type { EnrollmentStatus, ExitReason } from "../schemas/sequence-schemas";

export type CreateEnrollmentInput = {
  sequenceId: string;
  contactId: string;
  campaignRunId?: string;
  enrolledById: string;
  currentStepIndex?: number;
  nextSendAt?: Date | null;
};

export async function createEmailEnrollments(
  organizationId: string,
  enrollments: CreateEnrollmentInput[],
) {
  if (enrollments.length === 0) {
    return [];
  }

  return prisma.$transaction(
    enrollments.map((enrollment) =>
      prisma.emailEnrollment.create({
        data: {
          id: createId("eenrl"),
          organizationId,
          sequenceId: enrollment.sequenceId,
          contactId: enrollment.contactId,
          campaignRunId: enrollment.campaignRunId,
          enrolledById: enrollment.enrolledById,
          currentStepIndex: enrollment.currentStepIndex ?? 0,
          nextSendAt: enrollment.nextSendAt ?? null,
          status: "active",
        },
      }),
    ),
  );
}

export async function getEmailEnrollmentById(enrollmentId: string, organizationId: string) {
  return prisma.emailEnrollment.findFirst({
    where: { id: enrollmentId, organizationId },
    include: {
      sequence: { include: { steps: { orderBy: { sortOrder: "asc" } } } },
      campaignRun: true,
    },
  });
}

export async function getActiveEnrollmentForContactAndSequence(
  contactId: string,
  sequenceId: string,
  organizationId: string,
) {
  return prisma.emailEnrollment.findFirst({
    where: {
      contactId,
      sequenceId,
      organizationId,
      status: "active",
    },
  });
}

export async function listEnrollmentsByCampaignRun(campaignRunId: string, organizationId: string) {
  return prisma.emailEnrollment.findMany({
    where: { campaignRunId, organizationId },
  });
}

export async function listActiveEnrollmentsForContact(contactId: string, organizationId: string) {
  return prisma.emailEnrollment.findMany({
    where: { contactId, organizationId, status: "active" },
    include: { sequence: true },
  });
}

export async function updateEmailEnrollment(
  enrollmentId: string,
  organizationId: string,
  data: {
    status?: EnrollmentStatus;
    currentStepIndex?: number;
    nextSendAt?: Date | null;
    exitReason?: ExitReason | null;
    completedAt?: Date | null;
  },
) {
  return prisma.emailEnrollment.update({
    where: { id: enrollmentId, organizationId },
    data,
  });
}

export async function exitActiveEnrollmentsForContact(
  contactId: string,
  organizationId: string,
  exitReason: ExitReason,
  sequenceId?: string,
) {
  return prisma.emailEnrollment.updateMany({
    where: {
      contactId,
      organizationId,
      status: "active",
      ...(sequenceId ? { sequenceId } : {}),
    },
    data: {
      status: "exited",
      exitReason,
      completedAt: new Date(),
      nextSendAt: null,
    },
  });
}

export async function countEnrollmentsByStatus(sequenceId: string, organizationId: string) {
  const rows = await prisma.emailEnrollment.groupBy({
    by: ["status"],
    where: { sequenceId, organizationId },
    _count: { _all: true },
  });
  return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
}
