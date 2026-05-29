import { PubSub, type Message } from "@google-cloud/pubsub";

import { keys } from "../../keys";
import type { JobEnvelope, QueueAdapter, ReceivedMessage } from "../types";

export interface PubsubConsumer {
  /** Subscribe and dispatch messages until `abort` fires. Returns when stopped. */
  consume(
    onMessage: (received: ReceivedMessage) => Promise<"ack" | "nack" | "skip">,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

export interface PubsubAdapter extends QueueAdapter, PubsubConsumer {}

export function createPubsubAdapter(): PubsubAdapter {
  const { GCP_PROJECT_ID, PUBSUB_TOPIC_NAME, PUBSUB_SUBSCRIPTION_NAME } = keys();
  if (!GCP_PROJECT_ID) {
    throw new Error("GCP_PROJECT_ID is required for the pubsub adapter");
  }

  const pubsub = new PubSub({ projectId: GCP_PROJECT_ID });
  const topic = pubsub.topic(PUBSUB_TOPIC_NAME);
  const subscription = pubsub.subscription(PUBSUB_SUBSCRIPTION_NAME);

  return {
    async publish(_queue, envelope: JobEnvelope) {
      const data = Buffer.from(JSON.stringify(envelope));
      const messageId = await topic.publishMessage({ data });
      return messageId;
    },

    async consume(onMessage, { signal } = {}) {
      return new Promise<void>((resolve, reject) => {
        const handle = async (message: Message) => {
          const envelope = parseSafely(message.data);
          if (!envelope) {
            console.error(`[pubsub] poison message ${message.id}; acking to drop`);
            message.ack();
            return;
          }
          const received: ReceivedMessage = {
            msgId: message.id,
            readCount: message.deliveryAttempt ?? 1,
            envelope,
          };
          try {
            const verdict = await onMessage(received);
            if (verdict === "ack") {
              message.ack();
            } else if (verdict === "nack") {
              message.nack();
            }
          } catch (err) {
            console.error(`[pubsub] handler crashed on ${message.id}`, err);
            message.nack();
          }
        };

        subscription.on("message", handle);
        subscription.on("error", (err) => {
          subscription.removeAllListeners();
          reject(err);
        });

        signal?.addEventListener(
          "abort",
          () => {
            subscription.removeAllListeners();
            subscription.close().then(resolve).catch(reject);
          },
          { once: true },
        );
      });
    },
  };
}

function parseSafely(buf: Buffer): JobEnvelope | null {
  try {
    const parsed = JSON.parse(buf.toString("utf8"));
    return parsed as JobEnvelope;
  } catch {
    return null;
  }
}
