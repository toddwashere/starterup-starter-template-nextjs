import { prisma } from "@workspace/database";
import { createId } from "@workspace/common";

export async function appendEmailDeliveryEvent(data: {
  stepSendId?: string;
  provider: string;
  providerMessageId: string;
  type: string;
  bounceClass?: string;
  occurredAt: Date;
  rawType?: string;
}) {
  return prisma.emailDeliveryEvent.create({
    data: {
      id: createId("edevt"),
      stepSendId: data.stepSendId,
      provider: data.provider,
      providerMessageId: data.providerMessageId,
      type: data.type,
      bounceClass: data.bounceClass,
      occurredAt: data.occurredAt,
      rawType: data.rawType,
    },
  });
}
