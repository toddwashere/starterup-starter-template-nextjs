import { NextResponse } from "next/server";
import { Worker, type Job, type Processor } from "bullmq";
import { keys as queueKeys } from "@workspace/worker-queue/keys";
import {
  parseJobEnvelope,
  type EventName,
  type JobEnvelope,
} from "@workspace/worker-queue";

// TODO: Relocate handlers + getHandler to a shared package (e.g.
// @workspace/worker-handlers) so both @apps/workers and @apps/dashboard can
// import them without cross-app dependency. For now the types are inlined here
// and the handler map is left as a runtime stub that throws — drain is
// functional for queue draining/retries but won't process jobs until the
// shared package is created.
//
// Tracking issue: extract handlers to @workspace/worker-handlers
type JobHandler = (
  payload: ReturnType<typeof parseJobEnvelope>["payload"],
) => Promise<void>;
type HandlerRegistry = Record<EventName, JobHandler>;

function getHandler(
  registry: Partial<HandlerRegistry>,
  event: EventName,
): JobHandler {
  const handler = registry[event];
  if (!handler) {
    throw new Error(`No handler registered for event: ${event}`);
  }
  return handler;
}

// Stub registry — replace with real import once @workspace/worker-handlers exists.
const handlers: Partial<HandlerRegistry> = {};

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_JOBS_PER_INVOCATION = 10;

function authorized(req: Request): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const header = req.headers.get("authorization") ?? "";
  return header === `Bearer ${secret}`;
}

export async function POST(req: Request): Promise<Response> {
  if (!authorized(req)) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { REDIS_URL, BULLMQ_QUEUE_NAME } = queueKeys();
  if (!REDIS_URL) {
    return NextResponse.json(
      { error: "REDIS_URL not configured" },
      { status: 500 },
    );
  }

  let processed = 0;
  const failures: Array<{ jobId: string; error: string }> = [];

  // Drain mode: process at most MAX_JOBS_PER_INVOCATION jobs and exit. We
  // construct a one-shot Worker that closes after our idle/budget timeout.
  const connection = {
    url: REDIS_URL,
    maxRetriesPerRequest: null as null,
  };

  const processor: Processor = async (job: Job) => {
    let envelope: JobEnvelope;
    try {
      envelope = parseJobEnvelope(job.data);
    } catch {
      // Poison message — mark complete (drop) rather than retrying forever.
      failures.push({ jobId: String(job.id), error: "poison: invalid envelope" });
      return;
    }
    try {
      const handler = getHandler(handlers, envelope.event as EventName);
      await handler(envelope.payload);
      processed++;
    } catch (err) {
      failures.push({
        jobId: String(job.id),
        error: err instanceof Error ? err.message : String(err),
      });
      throw err; // let BullMQ retry according to job options
    }
  };

  const worker = new Worker(BULLMQ_QUEUE_NAME, processor, {
    connection,
    concurrency: 1,
    autorun: true,
  });

  // Resolve when queue goes idle (no more jobs for 2s).
  const stopWhenIdle = new Promise<void>((resolve) => {
    let idleTimer: ReturnType<typeof setTimeout> | undefined;
    const arm = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => resolve(), 2000);
    };
    worker.on("completed", arm);
    worker.on("failed", arm);
    worker.on("drained", () => resolve());
    arm();
  });

  // Hard cap: 8s (leaves headroom in a 10s Vercel Hobby timeout).
  const maxBudget = new Promise<void>((resolve) =>
    setTimeout(resolve, 8_000),
  );

  // Per-invocation job cap.
  const jobCap = new Promise<void>((resolve) => {
    const interval = setInterval(() => {
      if (processed >= MAX_JOBS_PER_INVOCATION) {
        clearInterval(interval);
        resolve();
      }
    }, 50);
  });

  await Promise.race([stopWhenIdle, maxBudget, jobCap]);
  await worker.close();

  return NextResponse.json({ processed, failures }, { status: 200 });
}
