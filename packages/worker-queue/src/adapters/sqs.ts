import {
  SQSClient,
  SendMessageCommand,
  ReceiveMessageCommand,
  DeleteMessageCommand,
  ChangeMessageVisibilityCommand,
} from "@aws-sdk/client-sqs";
import { awsCredentialsProvider } from "@vercel/functions/oidc";

import { keys } from "../../keys";
import type { JobEnvelope, QueueAdapter, ReceivedMessage } from "../types";

export interface SqsConsumer {
  consume(
    onMessage: (received: ReceivedMessage) => Promise<"ack" | "nack" | "skip">,
    options?: { signal?: AbortSignal },
  ): Promise<void>;
}

export interface SqsAdapter extends QueueAdapter, SqsConsumer {}

export function createSqsAdapter(): SqsAdapter {
  const { SQS_QUEUE_URL, AWS_REGION, AWS_ROLE_ARN } = keys();
  if (!SQS_QUEUE_URL) throw new Error("SQS_QUEUE_URL is required for the sqs adapter");
  // On Vercel, AWS_ROLE_ARN drives OIDC-assumed (keyless) credentials; in AWS
  // the default credential chain (task role) resolves credentials.
  const client = new SQSClient({
    region: AWS_REGION,
    ...(AWS_ROLE_ARN
      ? { credentials: awsCredentialsProvider({ roleArn: AWS_ROLE_ARN }) }
      : {}),
  });

  return {
    async publish(_queue, envelope: JobEnvelope) {
      const out = await client.send(
        new SendMessageCommand({
          QueueUrl: SQS_QUEUE_URL,
          MessageBody: JSON.stringify(envelope),
        }),
      );
      return out.MessageId ?? "";
    },

    async consume(onMessage, { signal } = {}) {
      while (!signal?.aborted) {
        const out = await client.send(
          new ReceiveMessageCommand({
            QueueUrl: SQS_QUEUE_URL,
            MaxNumberOfMessages: 10,
            WaitTimeSeconds: 20, // long poll
          }),
        );
        for (const msg of out.Messages ?? []) {
          if (signal?.aborted) break;
          if (!msg.Body || !msg.ReceiptHandle) continue;
          let envelope: JobEnvelope;
          try {
            envelope = JSON.parse(msg.Body) as JobEnvelope;
          } catch {
            console.error(`[sqs] poison message ${msg.MessageId}`);
            await client.send(
              new DeleteMessageCommand({
                QueueUrl: SQS_QUEUE_URL,
                ReceiptHandle: msg.ReceiptHandle,
              }),
            );
            continue;
          }
          const received: ReceivedMessage = {
            msgId: msg.MessageId ?? "",
            readCount: 1, // SQS doesn't expose attempt directly without ApproximateReceiveCount attr
            envelope,
          };
          try {
            const verdict = await onMessage(received);
            if (verdict === "ack") {
              await client.send(
                new DeleteMessageCommand({
                  QueueUrl: SQS_QUEUE_URL,
                  ReceiptHandle: msg.ReceiptHandle,
                }),
              );
            } else if (verdict === "nack") {
              await client.send(
                new ChangeMessageVisibilityCommand({
                  QueueUrl: SQS_QUEUE_URL,
                  ReceiptHandle: msg.ReceiptHandle,
                  VisibilityTimeout: 0,
                }),
              );
            }
          } catch {
            await client.send(
              new ChangeMessageVisibilityCommand({
                QueueUrl: SQS_QUEUE_URL,
                ReceiptHandle: msg.ReceiptHandle,
                VisibilityTimeout: 0,
              }),
            );
          }
        }
      }
    },
  };
}
