export type QueueAdapter = "bullmq" | "pubsub" | "sqs" | "servicebus" | "sync";
export type ConsumerMode = "poll" | "drain" | "inline";
export type ProfileName = "local" | "render" | "vercel" | "gcp" | "aws" | "azure";

export interface QueueProfile {
  adapter: QueueAdapter;
  consumerMode: ConsumerMode;
}

export const QUEUE_PROFILES: Readonly<Record<ProfileName, QueueProfile>> = {
  local: { adapter: "bullmq", consumerMode: "poll" },
  render: { adapter: "bullmq", consumerMode: "poll" },
  vercel: { adapter: "bullmq", consumerMode: "drain" },
  gcp: { adapter: "pubsub", consumerMode: "poll" },
  aws: { adapter: "sqs", consumerMode: "poll" },
  azure: { adapter: "servicebus", consumerMode: "poll" },
};

export function getQueueProfile(name: ProfileName): QueueProfile {
  return QUEUE_PROFILES[name];
}
