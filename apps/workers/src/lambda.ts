import type { SQSEvent, SQSBatchResponse } from "aws-lambda";
import type { EventName } from "@workspace/worker-queue";
import { getHandler, type HandlerRegistry } from "./registry";
import { handlers } from "./handlers";

/**
 * SQS event source mapping entrypoint (AWS profile). Reuses the shared handler
 * registry. Enable ReportBatchItemFailures on the event source mapping so that
 * returned itemIdentifiers redrive individually to the DLQ rather than
 * reprocessing the entire batch.
 */
export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const batchItemFailures: { itemIdentifier: string }[] = [];
  for (const record of event.Records) {
    try {
      const envelope = JSON.parse(record.body) as { event: EventName; payload: unknown };
      const run = getHandler(handlers as HandlerRegistry, envelope.event);
      await run(envelope.payload as never);
    } catch (err) {
      console.error(`[workers] failed ${record.messageId}`, err);
      batchItemFailures.push({ itemIdentifier: record.messageId });
    }
  }
  return { batchItemFailures };
}
