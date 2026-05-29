import {
  createSqsAdapter,
  parseJobEnvelope,
  type EventName,
  type JobEnvelope,
} from "@workspace/worker-queue";

import { getHandler, type HandlerRegistry } from "./registry";

export interface SqsWorkerDeps {
  registry: HandlerRegistry;
}

export interface RunningSqsWorker {
  stop: () => Promise<void>;
}

export function startSqsWorker(deps: SqsWorkerDeps): RunningSqsWorker {
  const adapter = createSqsAdapter();
  const controller = new AbortController();

  const consuming = adapter.consume(
    async (received) => {
      let envelope: JobEnvelope;
      try {
        envelope = parseJobEnvelope(received.envelope);
      } catch (err) {
        console.error(`[workers] poison message ${received.msgId}`, err);
        return "ack"; // drop poison
      }
      try {
        const handler = getHandler(deps.registry, envelope.event as EventName);
        await handler(envelope.payload as never);
        return "ack";
      } catch (err) {
        console.error(`[workers] handler error for ${envelope.event}`, err);
        return "nack";
      }
    },
    { signal: controller.signal },
  );

  consuming.catch((err) => console.error("[workers] sqs consume crashed", err));

  return {
    stop: async () => {
      controller.abort();
      await consuming;
    },
  };
}
