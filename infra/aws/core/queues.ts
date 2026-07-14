import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

/**
 * SQS queue registry.
 *
 * Add a queue by appending a {@link QueueSpec} to {@link QUEUES}. Each entry gets
 * a matching dead-letter queue automatically — you never hand-wire a DLQ. The
 * physical names are `starter-<key>-<stack>` and `starter-<key>-dlq-<stack>`, so
 * they stay unique per environment.
 *
 * The `jobs` queue is load-bearing (the workers Lambda + EventBridge Scheduler in
 * the apps stack consume it). Keep its `key` stable. New queues need their own
 * consumer wiring in `infra/aws/apps/index.ts`.
 */
export interface QueueSpec {
  /** Logical + physical name key. Physical name: `starter-<key>-<stack>`. */
  key: string;
  /** How long a received message is hidden from other consumers (default 60s). */
  visibilityTimeoutSeconds?: number;
  /** How long an unconsumed message is retained (default 4 days). */
  messageRetentionSeconds?: number;
  /** Deliveries before a message is redriven to the DLQ (default 5). */
  maxReceiveCount?: number;
  /** How long the DLQ retains failed messages (default 14 days). */
  dlqMessageRetentionSeconds?: number;
}

const DEFAULT_VISIBILITY = 60;
const DEFAULT_RETENTION = 345600; // 4 days
const DEFAULT_MAX_RECEIVE = 5;
const DEFAULT_DLQ_RETENTION = 1209600; // 14 days

export const QUEUES: readonly QueueSpec[] = [
  {
    key: "jobs",
    visibilityTimeoutSeconds: 60,
    messageRetentionSeconds: 345600,
    maxReceiveCount: 5,
    dlqMessageRetentionSeconds: 1209600,
  },
];

export interface BuiltQueue {
  queue: aws.sqs.Queue;
  dlq: aws.sqs.Queue;
}

/**
 * Create every queue in `specs` (defaults to {@link QUEUES}) with an attached
 * dead-letter queue and a redrive policy. Returns a map keyed by `QueueSpec.key`.
 */
export function buildQueues(opts: {
  stack: string;
  tags: Record<string, string>;
  specs?: readonly QueueSpec[];
}): Record<string, BuiltQueue> {
  const { stack, tags } = opts;
  const specs = opts.specs ?? QUEUES;
  const out: Record<string, BuiltQueue> = {};

  for (const spec of specs) {
    const dlq = new aws.sqs.Queue(`${spec.key}-dlq`, {
      name: `starter-${spec.key}-dlq-${stack}`,
      messageRetentionSeconds:
        spec.dlqMessageRetentionSeconds ?? DEFAULT_DLQ_RETENTION,
      tags,
    });

    const queue = new aws.sqs.Queue(spec.key, {
      name: `starter-${spec.key}-${stack}`,
      visibilityTimeoutSeconds:
        spec.visibilityTimeoutSeconds ?? DEFAULT_VISIBILITY,
      messageRetentionSeconds: spec.messageRetentionSeconds ?? DEFAULT_RETENTION,
      redrivePolicy: pulumi.jsonStringify({
        deadLetterTargetArn: dlq.arn,
        maxReceiveCount: spec.maxReceiveCount ?? DEFAULT_MAX_RECEIVE,
      }),
      tags,
    });

    out[spec.key] = { queue, dlq };
  }

  return out;
}
