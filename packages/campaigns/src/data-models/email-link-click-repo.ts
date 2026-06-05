import { prisma } from "@workspace/database";
import { createId } from "@workspace/common";

export async function insertEmailLinkClick(data: {
  stepSendId: string;
  destinationUrl: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  utmContent: string;
}) {
  return prisma.emailLinkClick.create({
    data: {
      id: createId("eclk"),
      stepSendId: data.stepSendId,
      destinationUrl: data.destinationUrl,
      utmSource: data.utmSource,
      utmMedium: data.utmMedium,
      utmCampaign: data.utmCampaign,
      utmContent: data.utmContent,
    },
  });
}

export async function countLinkClicksByStepSend(stepSendId: string) {
  return prisma.emailLinkClick.count({ where: { stepSendId } });
}

export async function countLinkClicksByStepForSequence(
  sequenceId: string,
  organizationId: string,
) {
  const clicks = await prisma.emailLinkClick.findMany({
    where: {
      stepSend: {
        enrollment: { sequenceId, organizationId },
      },
    },
    select: { stepSend: { select: { stepId: true } } },
  });

  return clicks.reduce<Record<string, number>>((acc, click) => {
    const stepId = click.stepSend.stepId;
    acc[stepId] = (acc[stepId] ?? 0) + 1;
    return acc;
  }, {});
}
