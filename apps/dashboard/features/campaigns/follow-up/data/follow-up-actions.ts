"use server";

import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import {
  listSequences,
  getSequence,
  createSequence,
  updateSequence,
  addSequenceStep,
  updateSequenceStep,
  getSequenceStep,
  enrollContactsInFollowUp,
  listActiveEnrollmentsForContact,
  getSequenceReportingStats,
  CreateEmailSequenceStepSchema,
  type CreateEmailSequenceInput,
  type CreateEmailSequenceStepInput,
  type UpdateEmailSequenceInput,
  type UpdateEmailSequenceStepInput,
} from "@workspace/campaigns";
import type { ActionResult } from "@/common/data/action-result";

const DEFAULT_EDITOR_HTML = `
  <p>We wanted to reach out.</p>
  <p><a href="https://example.com">Learn more</a></p>
`;

const DEFAULT_EDITOR_TEXT = "We wanted to reach out.\nLearn more";

export async function listFollowUpSequencesAction(): Promise<
  ActionResult<Awaited<ReturnType<typeof listSequences>>>
> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["read"],
    });
    const data = await listSequences(activeOrganizationId, "follow_up");
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load follow-ups",
    };
  }
}

export async function getFollowUpSequenceAction(sequenceId: string): Promise<
  ActionResult<{
    sequence: NonNullable<Awaited<ReturnType<typeof getSequence>>>;
    stats: Awaited<ReturnType<typeof getSequenceReportingStats>>;
  }>
> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["read"],
    });
    const sequence = await getSequence(sequenceId, activeOrganizationId);
    if (!sequence || sequence.kind !== "follow_up") {
      return { success: false, error: "Follow-up not found" };
    }
    const stats = await getSequenceReportingStats(sequenceId, activeOrganizationId);
    return { success: true, data: { sequence, stats } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load follow-up",
    };
  }
}

export async function createFollowUpSequenceAction(
  data: CreateEmailSequenceInput & { steps?: CreateEmailSequenceStepInput[] },
): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["create"],
    });
    const { steps, ...sequenceData } = data;
    const sequence = await createSequence(activeOrganizationId, session.user.id, {
      ...sequenceData,
      kind: "follow_up",
      status: sequenceData.status ?? "draft",
    });

    if (steps?.length) {
      for (const step of steps) {
        await addSequenceStep(sequence.id, activeOrganizationId, step);
      }
    }

    return { success: true, data: { id: sequence.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create follow-up",
    };
  }
}

export async function updateFollowUpSequenceAction(
  sequenceId: string,
  data: UpdateEmailSequenceInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["update"],
    });
    const existing = await getSequence(sequenceId, activeOrganizationId);
    if (!existing || existing.kind !== "follow_up") {
      return { success: false, error: "Follow-up not found" };
    }
    const sequence = await updateSequence(sequenceId, activeOrganizationId, data);
    return { success: true, data: { id: sequence.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update follow-up",
    };
  }
}

export async function saveFollowUpSequenceStepsAction(
  sequenceId: string,
  steps: Array<
    CreateEmailSequenceStepInput &
      UpdateEmailSequenceStepInput & { id?: string }
  >,
): Promise<ActionResult> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["update"],
    });
    const existing = await getSequence(sequenceId, activeOrganizationId);
    if (!existing || existing.kind !== "follow_up") {
      return { success: false, error: "Follow-up not found" };
    }

    for (const step of steps) {
      const { id, ...rest } = step;
      const parsed = CreateEmailSequenceStepSchema.parse(rest);
      if (id) {
        await updateSequenceStep(id, sequenceId, activeOrganizationId, parsed);
      } else {
        await addSequenceStep(sequenceId, activeOrganizationId, parsed);
      }
    }

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to save follow-up steps",
    };
  }
}

export async function createFollowUpStepAction(
  sequenceId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["update"],
    });
    const sequence = await getSequence(sequenceId, activeOrganizationId);
    if (!sequence || sequence.kind !== "follow_up") {
      return { success: false, error: "Follow-up not found" };
    }

    const step = await addSequenceStep(sequenceId, activeOrganizationId, {
      sortOrder: sequence.steps.length,
      delayMinutes: sequence.steps.length === 0 ? 0 : 1440,
      contentSource: "editor",
      templateKey: "nurture-intro",
      subjectTemplate: "Hello {{firstName}}",
      editorDocument: DEFAULT_EDITOR_HTML,
      composedBodyHtml: DEFAULT_EDITOR_HTML,
      composedBodyText: DEFAULT_EDITOR_TEXT,
    });

    return { success: true, data: { id: step.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to create follow-up step",
    };
  }
}

export async function getFollowUpStepAction(
  sequenceId: string,
  stepId: string,
): Promise<
  ActionResult<NonNullable<Awaited<ReturnType<typeof getSequenceStep>>>>
> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["read"],
    });
    const step = await getSequenceStep(stepId, activeOrganizationId);
    if (!step || step.sequenceId !== sequenceId || step.sequence.kind !== "follow_up") {
      return { success: false, error: "Follow-up step not found" };
    }
    return { success: true, data: step };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load follow-up step",
    };
  }
}

export async function updateFollowUpStepAction(
  sequenceId: string,
  stepId: string,
  data: CreateEmailSequenceStepInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["update"],
    });
    const step = await getSequenceStep(stepId, activeOrganizationId);
    if (!step || step.sequenceId !== sequenceId || step.sequence.kind !== "follow_up") {
      return { success: false, error: "Follow-up step not found" };
    }

    const parsed = CreateEmailSequenceStepSchema.parse(data);
    const updated = await updateSequenceStep(stepId, sequenceId, activeOrganizationId, parsed);
    return { success: true, data: { id: updated.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update follow-up step",
    };
  }
}

const MAX_FOLLOW_UP_ENROLL_IDS = 1000;

export async function enrollContactsInFollowUpAction(
  sequenceId: string,
  contactIds: string[],
): Promise<ActionResult<{ enrolledCount: number }>> {
  try {
    const { session, activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["send"],
    });

    if (contactIds.length === 0) {
      return { success: false, error: "No contacts selected" };
    }
    if (contactIds.length > MAX_FOLLOW_UP_ENROLL_IDS) {
      return {
        success: false,
        error: `Cannot enroll more than ${MAX_FOLLOW_UP_ENROLL_IDS} contacts at once`,
      };
    }

    const data = await enrollContactsInFollowUp(
      activeOrganizationId,
      sequenceId,
      contactIds,
      session.user.id,
    );
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to enroll contacts",
    };
  }
}

export async function listContactActiveEnrollmentsAction(
  contactId: string,
): Promise<
  ActionResult<Awaited<ReturnType<typeof listActiveEnrollmentsForContact>>>
> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["read"],
    });
    const data = await listActiveEnrollmentsForContact(contactId, activeOrganizationId);
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load enrollments",
    };
  }
}
