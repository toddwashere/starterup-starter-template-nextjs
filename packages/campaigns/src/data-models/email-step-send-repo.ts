import { prisma } from "@workspace/database";
import { createId } from "@workspace/common";
import type { StepSendStatus } from "../schemas/sequence-schemas";

export async function createEmailStepSend(data: {
  enrollmentId: string;
  stepId: string;
  idempotencyKey: string;
  status?: StepSendStatus;
}) {
  return prisma.emailStepSend.create({
    data: {
      id: createId("esend"),
      enrollmentId: data.enrollmentId,
      stepId: data.stepId,
      idempotencyKey: data.idempotencyKey,
      status: data.status ?? "pending",
      provider: "resend",
    },
  });
}

export async function getEmailStepSendById(stepSendId: string) {
  return prisma.emailStepSend.findFirst({
    where: { id: stepSendId },
    include: {
      enrollment: {
        include: {
          sequence: { include: { steps: { orderBy: { sortOrder: "asc" } } } },
          campaignRun: true,
        },
      },
      step: true,
    },
  });
}

export async function findEmailStepSendByProviderMessageId(providerMessageId: string) {
  return prisma.emailStepSend.findFirst({
    where: { providerMessageId },
    include: {
      enrollment: true,
    },
  });
}

export async function findEmailStepSendByIdempotencyKey(idempotencyKey: string) {
  return prisma.emailStepSend.findUnique({
    where: { idempotencyKey },
  });
}

export async function markEmailStepSendSent(
  stepSendId: string,
  providerMessageId: string,
) {
  return prisma.emailStepSend.update({
    where: { id: stepSendId },
    data: {
      status: "sent",
      providerMessageId,
      sentAt: new Date(),
    },
  });
}

export async function markEmailStepSendDelivered(stepSendId: string) {
  return prisma.emailStepSend.update({
    where: { id: stepSendId },
    data: {
      status: "delivered",
      deliveredAt: new Date(),
    },
  });
}

export async function markEmailStepSendFailed(stepSendId: string, failureReason: string) {
  return prisma.emailStepSend.update({
    where: { id: stepSendId },
    data: {
      status: "failed",
      failedAt: new Date(),
      failureReason,
    },
  });
}

export async function markEmailStepSendSkipped(stepSendId: string, failureReason: string) {
  return prisma.emailStepSend.update({
    where: { id: stepSendId },
    data: {
      status: "skipped",
      failedAt: new Date(),
      failureReason,
    },
  });
}

export async function countStepSendsByStep(sequenceId: string, organizationId: string) {
  const steps = await prisma.emailSequenceStep.findMany({
    where: { sequenceId },
    select: { id: true },
  });
  const stepIds = steps.map((s) => s.id);

  const rows = await prisma.emailStepSend.groupBy({
    by: ["stepId", "status"],
    where: {
      stepId: { in: stepIds },
      enrollment: { organizationId, sequenceId },
    },
    _count: { _all: true },
  });

  return rows;
}
