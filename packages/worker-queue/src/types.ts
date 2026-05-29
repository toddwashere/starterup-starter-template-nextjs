export type JobEnvelope = {
  event: string; // e.g. "user.welcome-email"
  payload: unknown; // validated against the events registry
  idempotencyKey?: string; // optional dedupe hint for handlers
  enqueuedAt?: string; // ISO timestamp, set by enqueue()
};

// Producer-facing adapter interface (implemented by sync/bullmq/cloud adapters):
export interface QueueAdapter {
  publish(queue: string, envelope: JobEnvelope): Promise<string>; // returns message id
}

// Consumer-facing shape (used by apps/workers later):
export interface ReceivedMessage {
  msgId: string; // adapter-specific message id (as string)
  readCount: number; // delivery attempt count
  envelope: JobEnvelope;
}
