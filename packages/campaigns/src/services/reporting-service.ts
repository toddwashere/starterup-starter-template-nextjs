import { countEnrollmentsByStatus } from "../data-models/email-enrollment-repo";
import { countStepSendsByStep } from "../data-models/email-step-send-repo";
import { countLinkClicksByStepForSequence } from "../data-models/email-link-click-repo";
import { getEmailSequenceById } from "../data-models/email-sequence-repo";

export async function getSequenceReportingStats(sequenceId: string, organizationId: string) {
  const sequence = await getEmailSequenceById(sequenceId, organizationId);
  if (!sequence) {
    throw new Error("Sequence not found in this organization");
  }

  const enrollmentCounts = await countEnrollmentsByStatus(sequenceId, organizationId);
  const stepSendCounts = await countStepSendsByStep(sequenceId, organizationId);
  const clickCounts = await countLinkClicksByStepForSequence(sequenceId, organizationId);

  const perStep = sequence.steps.map((step) => {
    const sends = stepSendCounts.filter((row) => row.stepId === step.id);
    const sendTotal = sends.reduce((sum, row) => sum + row._count._all, 0);
    const delivered = sends.find((row) => row.status === "delivered")?._count._all ?? 0;
    const sent = sends.find((row) => row.status === "sent")?._count._all ?? 0;
    const failed = sends.find((row) => row.status === "failed")?._count._all ?? 0;
    const skipped = sends.find((row) => row.status === "skipped")?._count._all ?? 0;

    return {
      stepId: step.id,
      sortOrder: step.sortOrder,
      sends: sendTotal,
      delivered: delivered + sent,
      failed,
      skipped,
      clicks: clickCounts[step.id] ?? 0,
    };
  });

  return {
    sequenceId,
    enrollmentCounts,
    perStep,
  };
}
