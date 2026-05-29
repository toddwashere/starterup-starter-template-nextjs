import { ServiceBusClient, type ServiceBusReceivedMessage } from "@azure/service-bus";
import { keys } from "../../keys";
import type { JobEnvelope, QueueAdapter, ReceivedMessage } from "../types";

export interface ServiceBusConsumer {
  consume(
    onMessage: (received: ReceivedMessage) => Promise<"ack" | "nack" | "skip">,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

export interface ServiceBusAdapter extends QueueAdapter, ServiceBusConsumer {}

export function createServiceBusAdapter(): ServiceBusAdapter {
  const { SERVICEBUS_CONNECTION_STRING, SERVICEBUS_QUEUE_NAME } = keys();
  if (!SERVICEBUS_CONNECTION_STRING)
    throw new Error("SERVICEBUS_CONNECTION_STRING is required for the servicebus adapter");
  const client = new ServiceBusClient(SERVICEBUS_CONNECTION_STRING);
  const sender = client.createSender(SERVICEBUS_QUEUE_NAME);
  const receiver = client.createReceiver(SERVICEBUS_QUEUE_NAME);

  return {
    async publish(_queue, envelope: JobEnvelope) {
      await sender.sendMessages({ body: envelope });
      return ""; // Service Bus doesn't return a synchronous message id
    },

    async consume(onMessage, { signal } = {}) {
      const subscription = receiver.subscribe({
        async processMessage(msg: ServiceBusReceivedMessage) {
          const received: ReceivedMessage = {
            msgId: msg.messageId?.toString() ?? "",
            readCount: msg.deliveryCount ?? 1,
            envelope: msg.body as JobEnvelope,
          };
          try {
            const verdict = await onMessage(received);
            if (verdict === "ack") {
              await receiver.completeMessage(msg);
            } else if (verdict === "nack") {
              await receiver.abandonMessage(msg);
            }
          } catch {
            await receiver.abandonMessage(msg);
          }
        },
        async processError(args) {
          console.error("[servicebus] error", args.error);
        },
      });

      const teardown = async () => {
        await subscription.close();
        await receiver.close();
        await sender.close();
        await client.close();
      };

      if (signal?.aborted) {
        await teardown();
        return;
      }

      await new Promise<void>((resolve) => {
        signal?.addEventListener(
          "abort",
          () => {
            void teardown().then(resolve);
          },
          { once: true },
        );
      });
    },
  };
}
