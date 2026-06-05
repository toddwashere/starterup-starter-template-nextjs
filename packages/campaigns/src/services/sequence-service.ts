import {
  listEmailSequencesForOrg,
  getEmailSequenceById,
  createEmailSequence,
  updateEmailSequence,
  createEmailSequenceStep,
  updateEmailSequenceStep,
  getEmailSequenceStepById,
  deleteEmailSequence,
  deleteEmailSequenceStep,
} from "../data-models/email-sequence-repo";
import type {
  CreateEmailSequenceInput,
  CreateEmailSequenceStepInput,
  SequenceKind,
  UpdateEmailSequenceInput,
  UpdateEmailSequenceStepInput,
} from "../schemas/sequence-schemas";

export async function listSequences(organizationId: string, kind?: SequenceKind) {
  return listEmailSequencesForOrg(organizationId, kind);
}

export async function getSequence(sequenceId: string, organizationId: string) {
  return getEmailSequenceById(sequenceId, organizationId);
}

export async function createSequence(
  organizationId: string,
  createdById: string,
  data: CreateEmailSequenceInput,
) {
  return createEmailSequence(organizationId, createdById, data);
}

export async function updateSequence(
  sequenceId: string,
  organizationId: string,
  data: UpdateEmailSequenceInput,
) {
  return updateEmailSequence(sequenceId, organizationId, data);
}

export async function addSequenceStep(
  sequenceId: string,
  organizationId: string,
  data: CreateEmailSequenceStepInput,
) {
  return createEmailSequenceStep(sequenceId, organizationId, data);
}

export async function updateSequenceStep(
  stepId: string,
  sequenceId: string,
  organizationId: string,
  data: UpdateEmailSequenceStepInput,
) {
  return updateEmailSequenceStep(stepId, sequenceId, organizationId, data);
}

export async function getSequenceStep(stepId: string, organizationId: string) {
  return getEmailSequenceStepById(stepId, organizationId);
}

export async function deleteSequence(sequenceId: string, organizationId: string) {
  return deleteEmailSequence(sequenceId, organizationId);
}

export async function deleteSequenceStep(
  stepId: string,
  sequenceId: string,
  organizationId: string,
) {
  return deleteEmailSequenceStep(stepId, sequenceId, organizationId);
}
