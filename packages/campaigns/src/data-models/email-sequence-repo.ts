import { prisma } from "@workspace/database";
import { createId } from "@workspace/common";
import type {
  CreateEmailSequenceInput,
  CreateEmailSequenceStepInput,
  SequenceKind,
  UpdateEmailSequenceInput,
  UpdateEmailSequenceStepInput,
} from "../schemas/sequence-schemas";

export async function listEmailSequencesForOrg(organizationId: string, kind?: SequenceKind) {
  return prisma.emailSequence.findMany({
    where: {
      organizationId,
      ...(kind ? { kind } : {}),
    },
    include: { steps: { orderBy: { sortOrder: "asc" } } },
    orderBy: { name: "asc" },
  });
}

export async function getEmailSequenceById(sequenceId: string, organizationId: string) {
  return prisma.emailSequence.findFirst({
    where: { id: sequenceId, organizationId },
    include: { steps: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function getEmailSequenceBySlug(slug: string, organizationId: string) {
  return prisma.emailSequence.findFirst({
    where: { slug, organizationId },
    include: { steps: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function createEmailSequence(
  organizationId: string,
  createdById: string,
  data: CreateEmailSequenceInput,
) {
  return prisma.emailSequence.create({
    data: {
      id: createId("eseq"),
      organizationId,
      createdById,
      status: data.status ?? "draft",
      kind: data.kind,
      name: data.name,
      slug: data.slug,
    },
    include: { steps: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function updateEmailSequence(
  sequenceId: string,
  organizationId: string,
  data: UpdateEmailSequenceInput,
) {
  return prisma.emailSequence.update({
    where: { id: sequenceId, organizationId },
    data,
    include: { steps: { orderBy: { sortOrder: "asc" } } },
  });
}

export async function createEmailSequenceStep(
  sequenceId: string,
  organizationId: string,
  data: CreateEmailSequenceStepInput,
) {
  const sequence = await getEmailSequenceById(sequenceId, organizationId);
  if (!sequence) {
    throw new Error("Sequence not found in this organization");
  }

  return prisma.emailSequenceStep.create({
    data: {
      id: createId("estep"),
      sequenceId,
      sortOrder: data.sortOrder,
      delayMinutes: data.delayMinutes ?? 0,
      templateKey: data.templateKey,
      subjectTemplate: data.subjectTemplate,
      ...(data.templateProps !== undefined
        ? { templateProps: data.templateProps as object }
        : {}),
    },
  });
}

export async function updateEmailSequenceStep(
  stepId: string,
  sequenceId: string,
  organizationId: string,
  data: UpdateEmailSequenceStepInput,
) {
  const sequence = await getEmailSequenceById(sequenceId, organizationId);
  if (!sequence) {
    throw new Error("Sequence not found in this organization");
  }

  const { templateProps, ...rest } = data;
  return prisma.emailSequenceStep.update({
    where: { id: stepId, sequenceId },
    data: {
      ...rest,
      ...(templateProps !== undefined ? { templateProps: templateProps as object } : {}),
    },
  });
}

export async function getEmailSequenceStepById(stepId: string, organizationId: string) {
  return prisma.emailSequenceStep.findFirst({
    where: {
      id: stepId,
      sequence: { organizationId },
    },
    include: { sequence: true },
  });
}

export async function listStepsForSequence(sequenceId: string, organizationId: string) {
  const sequence = await getEmailSequenceById(sequenceId, organizationId);
  if (!sequence) {
    return [];
  }
  return sequence.steps;
}
