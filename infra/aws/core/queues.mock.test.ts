import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];

function installMocks() {
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        recorded.push({ type: args.type, name: args.name, inputs: args.inputs });
        return {
          id: `${args.name}-id`,
          state: {
            ...args.inputs,
            arn: `arn:aws:sqs:us-east-1:123456789012:${args.name}`,
            url: `https://sqs.us-east-1.amazonaws.com/123456789012/${args.name}`,
          },
        };
      },
      call: (args) => args.inputs,
    },
    "test-project",
    "test",
  );
}

const QUEUE_TYPE = "aws:sqs/queue:Queue";

describe("buildQueues", () => {
  let result: Record<string, { queue: unknown; dlq: unknown }>;

  beforeAll(async () => {
    vi.resetModules();
    recorded.length = 0;
    installMocks();
    const mod = await import("./queues.js");
    result = mod.buildQueues({
      stack: "sandbox",
      tags: { Project: "starter" },
      specs: [
        {
          key: "jobs",
          visibilityTimeoutSeconds: 60,
          messageRetentionSeconds: 345600,
          maxReceiveCount: 5,
        },
        { key: "emails" },
      ],
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }, 10000);

  it("creates one main queue and one DLQ per spec", () => {
    const queues = recorded.filter((r) => r.type === QUEUE_TYPE);
    // 2 specs => 2 main queues + 2 DLQs.
    expect(queues).toHaveLength(4);
    const names = queues.map((q) => q.inputs.name);
    expect(names).toContain("starter-jobs-sandbox");
    expect(names).toContain("starter-jobs-dlq-sandbox");
    expect(names).toContain("starter-emails-sandbox");
    expect(names).toContain("starter-emails-dlq-sandbox");
  });

  it("wires a redrive policy from the main queue to its DLQ", () => {
    const jobs = recorded.find((r) => r.inputs.name === "starter-jobs-sandbox");
    expect(jobs).toBeDefined();
    const redrive = JSON.parse(jobs!.inputs.redrivePolicy as string) as {
      deadLetterTargetArn: string;
      maxReceiveCount: number;
    };
    expect(redrive.maxReceiveCount).toBe(5);
    expect(redrive.deadLetterTargetArn).toContain("jobs-dlq");
  });

  it("applies sensible defaults when a spec omits them", () => {
    const emails = recorded.find(
      (r) => r.inputs.name === "starter-emails-sandbox",
    );
    expect(emails!.inputs.visibilityTimeoutSeconds).toBe(60);
    const redrive = JSON.parse(emails!.inputs.redrivePolicy as string) as {
      maxReceiveCount: number;
    };
    expect(redrive.maxReceiveCount).toBe(5);
  });

  it("returns a map keyed by the spec key", () => {
    expect(Object.keys(result).sort()).toEqual(["emails", "jobs"]);
  });
});
