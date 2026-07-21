import { beforeAll, describe, expect, it, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];

describe("aws bootstrap configured identity (mocked)", () => {
  beforeAll(async () => {
    vi.resetModules();
    vi.stubEnv("AWS_RESOURCE_PREFIX", "int-health");
    vi.stubEnv("AWS_STATE_ACCOUNT_ID", "444455556666");
    vi.stubEnv("AWS_DNS_ROOT_DOMAIN", "example.com");
    vi.stubEnv("AWS_POOLER_APP_EGRESS_CIDRS", "");
    vi.stubEnv("AWS_POOLER_DEVELOPER_CIDRS", "");
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          recorded.push({
            type: args.type,
            name: args.name,
            inputs: args.inputs,
          });
          const baseState: Record<string, unknown> = {
            ...args.inputs,
            arn: `arn:aws:iam::123456789012:${args.name}`,
            repositoryUrl: `123456789012.dkr.ecr.us-east-2.amazonaws.com/${
              (args.inputs.name as string | undefined) ?? args.name
            }`,
          };
          if (args.type === "aws:route53/zone:Zone") {
            baseState.zoneId = `Z${args.name.toUpperCase()}123456`;
            baseState.nameServers = [
              "ns-1.example.com",
              "ns-2.example.com",
              "ns-3.example.com",
              "ns-4.example.com",
            ];
          }
          if (args.type === "aws:sns/topic:Topic") {
            baseState.arn = `arn:aws:sns:us-east-2:123456789012:${args.inputs.name}`;
          }
          return {
            id: `${args.name}-id`,
            state: baseState,
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
          return args.inputs;
        },
      },
      "starter-aws-bootstrap",
      "sandbox",
    );
    pulumi.runtime.setAllConfig({
      "aws:region": "us-east-2",
      "starter-aws-bootstrap:githubRepo": "acme/starter",
      "starter-aws-bootstrap:budgetAmount": "100",
      "starter-aws-bootstrap:budgetNotificationEmail": "ops@example.com",
      "starter-aws-bootstrap:complianceMode": "none",
    });
    await import("./index");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }, 10000);

  it("namespaces ECR repositories under the configured identity", () => {
    const repositoryNames = recorded
      .filter((r) => r.type === "aws:ecr/repository:Repository")
      .map((r) => r.inputs.name as string);
    expect(repositoryNames).toContain("int-health/dashboard");
    expect(repositoryNames).toContain("int-health/www");
  });

  it("names the deploy role and scopes secrets to the environment path", async () => {
    const deployRole = recorded.find(
      (r) => r.type === "aws:iam/role:Role" && r.name === "github-deploy",
    );
    expect(deployRole?.inputs.name).toBe("int-health-sandbox-github-deploy");

    const policies = recorded.filter((r) => r.type === "aws:iam/rolePolicy:RolePolicy");
    const deployPolicy = policies.find((p) => p.name === "github-deploy-access");
    const policy = await new Promise<string>((resolve) =>
      pulumi.output(deployPolicy!.inputs.policy as string).apply(resolve),
    );
    expect(policy).toContain("arn:aws:secretsmanager:us-east-2:*:secret:/sandbox/*");
    expect(policy).toContain("arn:aws:logs:us-east-2:*:log-group:/sandbox/*");
    expect(policy).toContain("int-health-sandbox-pooler-*");
  });

  it("tags bootstrap resources with the configured Project identity", () => {
    const repos = recorded.filter((r) => r.type === "aws:ecr/repository:Repository");
    expect(repos[0]?.inputs.tags).toMatchObject({
      Project: "int-health",
      Environment: "sandbox",
      ManagedBy: "pulumi",
      Layer: "bootstrap",
    });
  });
});
