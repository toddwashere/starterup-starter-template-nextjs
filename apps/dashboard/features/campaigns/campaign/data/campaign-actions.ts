"use server";

import { headers } from "next/headers";
import { auth } from "@workspace/auth";
import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import {
  listSequences,
  getSequence,
  createSequence,
  updateSequence,
  addSequenceStep,
  updateSequenceStep,
  startCampaignRun,
  pauseCampaignSequence,
  getLatestCampaignRunForSequence,
  getSequenceReportingStats,
  marketingTemplateRegistry,
  signMarketingToken,
  keys as campaignKeys,
  CreateEmailSequenceStepSchema,
  type CreateEmailSequenceInput,
  type CreateEmailSequenceStepInput,
  type UpdateEmailSequenceInput,
  type UpdateEmailSequenceStepInput,
} from "@workspace/campaigns";
import { sendMarketingEmail } from "@workspace/email/marketing/send-marketing-email";
import type { ActionResult } from "@/common/data/action-result";

export type CampaignSequenceListItem = Awaited<
  ReturnType<typeof listSequences>
>[number] & {
  latestRun: Awaited<ReturnType<typeof getLatestCampaignRunForSequence>>;
};

export async function listCampaignSequencesAction(): Promise<
  ActionResult<CampaignSequenceListItem[]>
> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["read"],
    });
    const sequences = await listSequences(activeOrganizationId, "campaign");
    const withRuns = await Promise.all(
      sequences.map(async (sequence) => ({
        ...sequence,
        latestRun: await getLatestCampaignRunForSequence(sequence.id, activeOrganizationId),
      })),
    );
    return { success: true, data: withRuns };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load campaigns",
    };
  }
}

export async function getCampaignSequenceAction(
  sequenceId: string,
): Promise<
  ActionResult<{
    sequence: NonNullable<Awaited<ReturnType<typeof getSequence>>>;
    stats: Awaited<ReturnType<typeof getSequenceReportingStats>>;
    latestRun: Awaited<ReturnType<typeof getLatestCampaignRunForSequence>>;
  }>
> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["read"],
    });
    const sequence = await getSequence(sequenceId, activeOrganizationId);
    if (!sequence || sequence.kind !== "campaign") {
      return { success: false, error: "Campaign not found" };
    }
    const [stats, latestRun] = await Promise.all([
      getSequenceReportingStats(sequenceId, activeOrganizationId),
      getLatestCampaignRunForSequence(sequenceId, activeOrganizationId),
    ]);
    return { success: true, data: { sequence, stats, latestRun } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load campaign",
    };
  }
}

export async function createCampaignSequenceAction(
  data: CreateEmailSequenceInput & { steps?: CreateEmailSequenceStepInput[] },
): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["create"],
    });
    const { steps, ...sequenceData } = data;
    const sequence = await createSequence(activeOrganizationId, session.user.id, {
      ...sequenceData,
      kind: "campaign",
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
      error: err instanceof Error ? err.message : "Failed to create campaign",
    };
  }
}

export async function updateCampaignSequenceAction(
  sequenceId: string,
  data: UpdateEmailSequenceInput,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["update"],
    });
    const existing = await getSequence(sequenceId, activeOrganizationId);
    if (!existing || existing.kind !== "campaign") {
      return { success: false, error: "Campaign not found" };
    }
    const sequence = await updateSequence(sequenceId, activeOrganizationId, data);
    return { success: true, data: { id: sequence.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to update campaign",
    };
  }
}

export async function saveCampaignSequenceStepsAction(
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
    if (!existing || existing.kind !== "campaign") {
      return { success: false, error: "Campaign not found" };
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
      error: err instanceof Error ? err.message : "Failed to save campaign steps",
    };
  }
}

export async function startCampaignRunAction(
  sequenceId: string,
  segmentId: string,
): Promise<ActionResult<{ id: string }>> {
  try {
    const { session, activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["send"],
    });
    const run = await startCampaignRun(
      activeOrganizationId,
      sequenceId,
      segmentId,
      session.user.id,
    );
    return { success: true, data: { id: run.id } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to start campaign run",
    };
  }
}

export async function pauseCampaignSequenceAction(
  sequenceId: string,
): Promise<ActionResult> {
  try {
    const { activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["update"],
    });
    await pauseCampaignSequence(sequenceId, activeOrganizationId);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to pause campaign",
    };
  }
}

export async function sendCampaignTestEmailAction(
  sequenceId: string,
): Promise<ActionResult> {
  try {
    const { session, activeOrganizationId } = await requireOrgPermissionWithActiveOrg({
      campaign: ["send"],
    });

    const recipient = session.user.email;
    if (!recipient) {
      return { success: false, error: "Your account does not have an email address" };
    }

    const sequence = await getSequence(sequenceId, activeOrganizationId);
    if (!sequence || sequence.kind !== "campaign") {
      return { success: false, error: "Campaign not found" };
    }

    const step = sequence.steps[0];
    if (!step) {
      return { success: false, error: "Add at least one step before sending a test email" };
    }

    const requestHeaders = await headers();
    const org = await auth.api.getFullOrganization({ headers: requestHeaders });
    const organizationName = org?.name ?? "Our team";
    const publicBaseUrl = campaignKeys().NEXT_PUBLIC_WWW_URL.replace(/\/$/, "");
    const testContactId = `test-${session.user.id}`;

    const allToken = signMarketingToken({
      contactId: testContactId,
      organizationId: activeOrganizationId,
      scope: "all",
    });
    const sequenceToken = signMarketingToken({
      contactId: testContactId,
      organizationId: activeOrganizationId,
      scope: "sequence",
      sequenceId: sequence.id,
    });

    const clickTokenBase = {
      contactId: testContactId,
      organizationId: activeOrganizationId,
      scope: "click" as const,
      sequenceId: sequence.id,
      stepSendId: `test-${step.id}`,
      utmMedium: "campaign",
      utmCampaign: sequence.slug,
      utmContent: "step-1",
    };

    const sendInputBase = {
      recipient,
      subjectTemplate: step.subjectTemplate,
      organizationName,
      mergeData: {
        displayName: session.user.name ?? "Test recipient",
        firstName: session.user.name?.split(/\s+/)[0] ?? "",
        lastName: session.user.name?.split(/\s+/).slice(1).join(" ") ?? "",
        primaryEmail: recipient,
        organizationName,
      },
      unsubscribeUrl: `${publicBaseUrl}/email/preferences?token=${encodeURIComponent(sequenceToken)}`,
      oneClickUnsubscribeUrl: `${publicBaseUrl}/email/preferences/one-click?token=${encodeURIComponent(allToken)}`,
      buildClickRedirectUrl: (destinationUrl: string) => {
        const token = signMarketingToken({ ...clickTokenBase, destinationUrl });
        return `${publicBaseUrl}/email/go/${encodeURIComponent(token)}`;
      },
      metadata: {
        stepSendId: `test-${step.id}`,
        enrollmentId: `test-${sequence.id}`,
        sequenceId: sequence.id,
        organizationId: activeOrganizationId,
      },
    };

    if (step.contentSource === "editor") {
      if (!step.composedBodyHtml) {
        return {
          success: false,
          error: "Save the visual editor content before sending a test email",
        };
      }
      await sendMarketingEmail({
        ...sendInputBase,
        contentSource: "editor",
        previewText: step.subjectTemplate,
        bodyHtml: step.composedBodyHtml,
        bodyText: step.composedBodyText ?? "",
      });
    } else {
      const registryEntry =
        marketingTemplateRegistry[step.templateKey as keyof typeof marketingTemplateRegistry];
      if (!registryEntry) {
        return { success: false, error: `Unknown template: ${step.templateKey}` };
      }

      const parsedProps = registryEntry.propsSchema.parse(step.templateProps ?? {});

      await sendMarketingEmail({
        ...sendInputBase,
        contentSource: "registry",
        templateKey: step.templateKey as keyof typeof marketingTemplateRegistry,
        templateProps: parsedProps as Record<string, unknown>,
      });
    }

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to send test email",
    };
  }
}

export async function listMarketingTemplatesAction(): Promise<
  ActionResult<Array<{ key: string; label: string; description: string }>>
> {
  try {
    await requireOrgPermissionWithActiveOrg({ campaign: ["read"] });
    const templates = Object.entries(marketingTemplateRegistry).map(([key, entry]) => ({
      key,
      label: entry.label,
      description: entry.description,
    }));
    return { success: true, data: templates };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load templates",
    };
  }
}
