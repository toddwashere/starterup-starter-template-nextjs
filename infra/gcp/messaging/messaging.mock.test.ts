import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, any>;
}

const recorded: RecordedResource[] = [];

describe("messaging layer (mocked, sandbox, enableRedis off)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          recorded.push({ type: args.type, name: args.name, inputs: args.inputs });
          // StackReference for bootstrap: return empty networkId (sandbox = no private network).
          if (args.type === "pulumi:pulumi:StackReference") {
            return {
              id: `${args.name}-id`,
              state: {
                outputs: {
                  networkId: "",
                  projectId: "test-project",
                  regionOut: "us-central1",
                  vpcConnectorId: "",
                  complianceModeOut: "none",
                },
              },
            };
          }
          return {
            id: `${args.name}-id`,
            state: {
              ...args.inputs,
              name: args.inputs.name ?? args.name,
              // Redis instance computed outputs (only relevant when created).
              host: "10.0.0.3",
              port: 6379,
            },
          };
        },
        call: (args) => args.inputs,
      },
      "starter-gcp-messaging",
      "sandbox",
    );
    // Sandbox config: bootstrap ref + Redis disabled.
    // Use both PULUMI_CONFIG env injection and setAllConfig to ensure config
    // resolves across Pulumi versions (mirrors database.mock.test.ts pattern).
    const sandboxConfig = {
      "gcp:project": "test-project",
      "gcp:region": "us-central1",
      "starter-gcp-messaging:bootstrapStackRef": "test-org/starter-gcp-bootstrap/sandbox",
      "starter-gcp-messaging:enableRedis": "false",
    };
    process.env.PULUMI_CONFIG = JSON.stringify(sandboxConfig);
    pulumi.runtime.setAllConfig(sandboxConfig);
    infra = await import("./index");
    // Pulumi registers resources asynchronously in microtasks after the module
    // is imported. Yield to the event loop so all newResource calls complete
    // before the tests read the `recorded` array.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }, 10000);

  it("always creates the jobs topic, DLQ, and subscription", async () => {
    const topic = await new Promise<string>((res) => infra.pubsubTopicName.apply(res));
    const sub = await new Promise<string>((res) => infra.pubsubSubscriptionName.apply(res));
    const dlq = await new Promise<string>((res) => infra.pubsubDlqTopicName.apply(res));
    expect(topic).toContain("jobs-");
    expect(sub).toContain("jobs-sub-");
    expect(dlq).toContain("jobs-dlq-");
  });

  it("configures the subscription dead-letter + retry contract", () => {
    const sub = recorded.find((r) => r.type === "gcp:pubsub/subscription:Subscription");
    expect(sub).toBeDefined();
    expect(sub!.inputs.ackDeadlineSeconds).toBe(60);
    expect(sub!.inputs.retryPolicy.minimumBackoff).toBe("5s");
    expect(sub!.inputs.retryPolicy.maximumBackoff).toBe("600s");
    expect(sub!.inputs.deadLetterPolicy.maxDeliveryAttempts).toBe(5);
  });

  it("does NOT create a Redis instance when enableRedis is off", () => {
    const redis = recorded.filter((r) => r.type === "gcp:redis/instance:Instance");
    expect(redis).toHaveLength(0);
  });

  it("exports empty/zero Redis outputs when disabled", async () => {
    const host = await new Promise<string>((res) => infra.redisHost.apply(res));
    const port = await new Promise<number>((res) => infra.redisPort.apply(res));
    expect(host).toBe("");
    expect(port).toBe(0);
  });
});

// --- enableRedis ON path (documented; not committed as an always-running test) ---
//
// To assert the flag-on path, run a separate process (or test file) with:
//
//   const onConfig = {
//     "gcp:project": "test-project",
//     "gcp:region": "us-central1",
//     "starter-gcp-messaging:bootstrapStackRef": "test-org/starter-gcp-bootstrap/sandbox",
//     "starter-gcp-messaging:enableRedis": "true",
//     "starter-gcp-messaging:redisTier": "BASIC",
//     "starter-gcp-messaging:redisMemorySizeGb": "1",
//   };
//
// And in the setMocks newResource handler, for StackReference return:
//   state: { outputs: { networkId: "projects/test/global/networks/starter-vpc", ... } }
//
// Then assert:
//   - exactly one "gcp:redis/instance:Instance" is recorded
//   - its inputs.authorizedNetwork is non-empty
//   - its inputs.connectMode === "PRIVATE_SERVICE_ACCESS"
//   - its inputs.tier === "BASIC" and inputs.memorySizeGb === 1
//   - redisHost resolves to "10.0.0.3" (mock value) and redisPort to 6379
//
// No-network flag-on case (networkId ""):
//   - one Redis instance recorded WITHOUT authorizedNetwork / connectMode
//
// (A second always-running import of ./index in the same file is unreliable
//  due to module-level Pulumi runtime state; run as a separate process.)
