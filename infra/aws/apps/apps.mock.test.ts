import { beforeAll, describe, expect, it, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

import { SECRET_CATALOG } from "../../shared/secret-catalog";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];

const CORE_OUTPUTS: Record<string, unknown> = {
  privateSubnetIds: ["subnet-1", "subnet-2"],
  appSecurityGroupId: "sg-app",
  databaseUrlSecretArn:
    "arn:aws:secretsmanager:us-east-2:123456789012:secret:/staging/database-url",
  directUrlSecretArn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:/staging/direct-url",
  sqsQueueUrl: "https://sqs.us-east-2.amazonaws.com/123456789012/int-health-jobs-staging",
  sqsQueueArn: "arn:aws:sqs:us-east-2:123456789012:int-health-jobs-staging",
  uploadsBucket: "int-health-staging-uploads-abc",
  wafWebAclArn: "",
  // Catalog placeholder ARNs the core stack now exports (everything in
  // SECRET_CATALOG except `database-url`).
  catalogSecretArns: Object.fromEntries(
    SECRET_CATALOG.filter((s) => s.id !== "database-url").map((s) => [
      s.id,
      `arn:aws:secretsmanager:us-east-2:123456789012:secret:/staging/${s.id}`,
    ]),
  ),
};

describe("aws apps configured identity (mocked)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    vi.resetModules();
    recorded.length = 0;
    vi.stubEnv("AWS_RESOURCE_PREFIX", "int-health");
    vi.stubEnv("PULUMI_ORG", "organization");
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          recorded.push({
            type: args.type,
            name: args.name,
            inputs: args.inputs,
          });
          const state: Record<string, unknown> = {
            ...args.inputs,
            arn: `arn:aws:iam::123456789012:${args.name}`,
            serviceUrl: `https://${args.name}.example.com`,
          };
          if (args.type === "pulumi:pulumi:StackReference") {
            return {
              id: `${args.name}-id`,
              state: { ...state, outputs: CORE_OUTPUTS },
            };
          }
          return {
            id: `${args.name}-id`,
            state,
          };
        },
        call: (args) => {
          if (args.token.includes("getCallerIdentity")) {
            return {
              accountId: "123456789012",
              arn: "arn:aws:iam::123456789012:user/test",
              userId: "test",
            };
          }
          if (
            args.token.includes("getStackReferenceOutput") ||
            args.token.includes("StackReference")
          ) {
            const name = (args.inputs as { name?: string }).name;
            if (name && name in CORE_OUTPUTS) {
              return { value: CORE_OUTPUTS[name] };
            }
          }
          if (args.token.includes("getSecretVersion")) {
            return {
              secretString: "postgresql://starter:pass@db/starter",
              versionId: "1",
            };
          }
          return args.inputs;
        },
      },
      "starter-aws-apps",
      "staging",
    );
    pulumi.runtime.setAllConfig({
      "aws:region": "us-east-2",
    });
    infra = await import("./index");
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }, 20000);

  it("resolves the ECR registry under the configured identity", async () => {
    const imageRegistry = await new Promise<string>((resolve) =>
      pulumi.output(infra.imageRegistry).apply(resolve),
    );
    expect(imageRegistry).toBe("123456789012.dkr.ecr.us-east-2.amazonaws.com/int-health");
  });

  it("tags app resources with the configured Project identity", () => {
    const tagged = recorded.find((r) => {
      const tags = r.inputs.tags as Record<string, string> | undefined;
      return tags?.Project === "int-health" && tags?.Environment === "staging";
    });
    expect(tagged).toBeDefined();
    expect(tagged!.inputs.tags).toMatchObject({
      Project: "int-health",
      Environment: "staging",
      ManagedBy: "pulumi",
    });
  });
});
