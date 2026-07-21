import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { validatedGithubRepo } from "./bootstrap-config";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];

describe("aws bootstrap layer (mocked)", () => {
  let infra: typeof import("./index");

  it("rejects a missing or malformed GitHub repository scope", () => {
    expect(() => validatedGithubRepo(undefined)).toThrow(/required/);
    expect(() => validatedGithubRepo("owner")).toThrow(/owner\/repo/);
    expect(validatedGithubRepo("acme/starter")).toBe("acme/starter");
  });

  beforeAll(async () => {
    // Default identity is `starter` when AWS_RESOURCE_PREFIX is unset.
    vi.stubEnv("AWS_RESOURCE_PREFIX", "");
    vi.stubEnv("AWS_STATE_RESOURCE_PREFIX", "");
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
    infra = await import("./index");
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }, 10000);

  it("creates a GitHub Actions OIDC provider for the well-known issuer", () => {
    const providers = recorded.filter(
      (r) => r.type === "aws:iam/openIdConnectProvider:OpenIdConnectProvider",
    );
    expect(providers).toHaveLength(1);
    expect(providers[0].inputs.url).toBe("https://token.actions.githubusercontent.com");
    expect(providers[0].inputs.clientIdLists).toEqual(["sts.amazonaws.com"]);
  });

  it("scopes the deploy role trust policy to the configured repo", async () => {
    const roles = recorded.filter((r) => r.type === "aws:iam/role:Role");
    expect(roles).toHaveLength(1);
    const policyDoc = await new Promise<string>((res) =>
      pulumi.output(roles[0].inputs.assumeRolePolicy as string).apply(res),
    );
    expect(policyDoc).toContain("sts:AssumeRoleWithWebIdentity");
    expect(policyDoc).toContain("repo:acme/starter:*");
  });

  it("provisions per-app ECR repositories with scan-on-push", () => {
    const repos = recorded.filter((r) => r.type === "aws:ecr/repository:Repository");
    const names = repos.map((r) => r.inputs.name as string).sort();
    expect(names).toEqual([
      "starter/dashboard",
      "starter/public-api",
      "starter/public-mcp",
      "starter/workers",
      "starter/workers-lambda",
      "starter/www",
    ]);
    for (const repo of repos) {
      expect(repo.inputs.imageScanningConfiguration).toEqual({
        scanOnPush: true,
      });
    }
  });

  it("attaches only the base policy set when complianceMode is none", () => {
    const attachments = recorded.filter(
      (r) => r.type === "aws:iam/rolePolicyAttachment:RolePolicyAttachment",
    );
    // 9 base policies, no compliance extras.
    expect(attachments).toHaveLength(9);
    const arns = attachments.map((a) => a.inputs.policyArn);
    expect(arns).toContain("arn:aws:iam::aws:policy/AWSAppRunnerFullAccess");
    expect(arns).not.toContain("arn:aws:iam::aws:policy/AWSKeyManagementServicePowerUser");
  });

  it("grants the GitHub role access only to its central state bucket and KMS alias", async () => {
    const policies = recorded.filter((r) => r.type === "aws:iam/rolePolicy:RolePolicy");
    expect(policies).toHaveLength(2);
    const statePolicy = policies.find((p) => p.name === "github-state-access");
    expect(statePolicy).toBeDefined();
    const policy = await new Promise<string>((resolve) =>
      pulumi.output(statePolicy!.inputs.policy as string).apply(resolve),
    );
    expect(policy).toContain("arn:aws:s3:::starter-sandbox-444455556666-us-east-2");
    expect(policy).toContain("arn:aws:kms:us-east-2:444455556666:key/*");
    expect(policy).toContain("alias/starter-sandbox");
    expect(policy).not.toContain('"Resource":"*"');
  });

  it("names the GitHub deploy role with the default starter identity", () => {
    const roles = recorded.filter((r) => r.type === "aws:iam/role:Role");
    expect(roles[0]?.inputs.name).toBe("starter-sandbox-github-deploy");
  });

  it("creates a monthly budget when a notification email is set", () => {
    const budgets = recorded.filter((r) => r.type === "aws:budgets/budget:Budget");
    expect(budgets).toHaveLength(1);
    expect(budgets[0].inputs.timeUnit).toBe("MONTHLY");
    expect(budgets[0].inputs.limitAmount).toBe("100");
  });

  it("exports the deploy role ARN and ECR repository url", async () => {
    const roleArn = await new Promise<string>((res) => infra.deployRoleArn.apply(res));
    const repoUrl = await new Promise<string>((res) => infra.ecrRepositoryUrl.apply(res));
    expect(roleArn).toContain("arn:aws:iam::");
    expect(repoUrl).toContain("dkr.ecr");
  });

  it("creates a public delegated hosted zone for the environment", () => {
    const zones = recorded.filter((r) => r.type === "aws:route53/zone:Zone");
    expect(zones).toHaveLength(1);
    expect(zones[0].inputs.name).toBe("sandbox.aws.example.com");
    expect(zones[0].inputs.comment as string).toContain("delegated");
  });

  it("creates an SNS alert topic encrypted with a rotating customer-managed key", async () => {
    const keys = recorded.filter((r) => r.type === "aws:kms/key:Key");
    const alertKey = keys.find((key) =>
      (key.inputs.description as string)?.includes("infrastructure alert"),
    );
    expect(alertKey).toBeDefined();
    expect(alertKey?.inputs.enableKeyRotation).toBe(true);

    const aliases = recorded.filter((r) => r.type === "aws:kms/alias:Alias");
    expect(
      aliases.some((alias) => alias.inputs.name === "alias/starter-sandbox-infra-alerts"),
    ).toBe(true);

    const keyPolicy = await new Promise<string>((resolve) =>
      pulumi.output(alertKey!.inputs.policy as string).apply(resolve),
    );
    const parsedKeyPolicy = JSON.parse(keyPolicy);
    const snsGrant = parsedKeyPolicy.Statement.find(
      (statement: { Principal?: { Service?: string } }) =>
        statement.Principal?.Service === "sns.amazonaws.com",
    );
    expect(snsGrant.Action).toEqual(["kms:GenerateDataKey*", "kms:Decrypt"]);
    expect(snsGrant.Condition.StringEquals["aws:SourceAccount"]).toBe("123456789012");
    expect(snsGrant.Condition.StringEquals["aws:SourceArn"]).toBe(
      "arn:aws:sns:us-east-2:123456789012:starter-sandbox-infra-alerts",
    );
    const eventBridgeGrant = parsedKeyPolicy.Statement.find(
      (statement: { Principal?: { Service?: string } }) =>
        statement.Principal?.Service === "events.amazonaws.com",
    );
    expect(eventBridgeGrant.Action).toEqual(["kms:GenerateDataKey*", "kms:Decrypt"]);
    // AWS does not provide SourceArn/SourceAccount context for EventBridge
    // publishing to an encrypted SNS topic; adding either blocks delivery.
    expect(eventBridgeGrant.Condition).toBeUndefined();

    const topics = recorded.filter((r) => r.type === "aws:sns/topic:Topic");
    expect(topics).toHaveLength(1);
    expect(topics[0].inputs.name).toBe("starter-sandbox-infra-alerts");
    expect(topics[0].inputs.kmsMasterKeyId).toBeDefined();
    expect(topics[0].inputs.kmsMasterKeyId).not.toBe("alias/aws/sns");
    const subscriptions = recorded.filter(
      (r) => r.type === "aws:sns/topicSubscription:TopicSubscription",
    );
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].inputs.endpoint).toBe("ops@example.com");
  });

  it("allows only account-scoped EventBridge and CloudWatch publishers", async () => {
    const policies = recorded.filter((r) => r.type === "aws:sns/topicPolicy:TopicPolicy");
    expect(policies).toHaveLength(1);
    const policyJson = await new Promise<string>((resolve) =>
      pulumi.output(policies[0].inputs.policy as string).apply(resolve),
    );
    const policy = JSON.parse(policyJson);

    const owner = policy.Statement.find(
      (statement: { Sid?: string }) => statement.Sid === "OwnerPermissions",
    );
    expect(owner.Principal).toEqual({ AWS: "arn:aws:iam::123456789012:root" });
    expect(owner.Action).toContain("sns:SetTopicAttributes");

    for (const service of ["events.amazonaws.com", "cloudwatch.amazonaws.com"]) {
      const publisher = policy.Statement.find(
        (statement: { Principal?: { Service?: string } }) =>
          statement.Principal?.Service === service,
      );
      expect(publisher).toBeDefined();
      expect(publisher.Action).toBe("sns:Publish");
      expect(publisher.Condition.StringEquals["aws:SourceAccount"]).toBe("123456789012");
      expect(publisher.Condition.ArnLike["aws:SourceArn"]).toContain("123456789012");
    }

    expect(
      policy.Statement.every((statement: { Principal?: unknown }) => statement.Principal !== "*"),
    ).toBe(true);
  });

  it("attaches an inline deployment policy with least-privilege resource scoping", async () => {
    const policies = recorded.filter((r) => r.type === "aws:iam/rolePolicy:RolePolicy");
    const deployPolicy = policies.find((p) => p.name === "github-deploy-access");
    expect(deployPolicy).toBeDefined();
    const policy = await new Promise<string>((resolve) =>
      pulumi.output(deployPolicy!.inputs.policy as string).apply(resolve),
    );
    expect(policy).toContain("route53:ChangeResourceRecordSets");
    expect(policy).toContain("acm:RequestCertificate");
    expect(policy).toContain("acm:ExportCertificate");
    expect(policy).toContain("acm:ListTagsForCertificate");
    expect(policy).toContain("acm:RemoveTagsFromCertificate");
    expect(policy).toContain("acm:UpdateCertificateOptions");
    expect(policy).toContain("lambda:CreateFunction");
    expect(policy).toContain("events:PutRule");
    expect(policy).toContain("logs:CreateLogGroup");
    expect(policy).toContain("cloudwatch:TagResource");
    expect(policy).toContain("sns:Publish");
    expect(policy).toContain("sns:SetTopicAttributes");
    expect(policy).toContain("secretsmanager:CreateSecret");
    expect(policy).toContain("kms:CreateKey");
    expect(policy).toContain("kms:UpdateKeyDescription");
    expect(policy).toContain("kms:DeleteAlias");
    expect(policy).toContain("ecs:CreateService");
    expect(policy).toContain("ecs:CreateCluster");
    expect(policy).toContain("iam:PassRole");
    expect(policy).toContain("starter-sandbox-pooler-*");
    // PassRole must also cover the PgBouncer ECS execution/task roles the core
    // stack creates, otherwise ECS service deploys fail once IAMFullAccess is
    // tightened away from the managed base policies.
    expect(policy).toContain("starter-sandbox-pgbouncer-*");
    const parsed = JSON.parse(policy);
    const logStatement = parsed.Statement.find(
      (statement: { Sid?: string }) => statement.Sid === "CloudWatchLogs",
    );
    expect(logStatement.Resource).toContain("arn:aws:logs:us-east-2:*:log-group:/sandbox/*");
    const ecsUnscoped = parsed.Statement.find(
      (statement: { Sid?: string }) => statement.Sid === "EcsUnscopedOperations",
    );
    expect(ecsUnscoped.Resource).toBe("*");
    expect(ecsUnscoped.Action).toContain("ecs:CreateCluster");
    expect(ecsUnscoped.Action).toContain("ecs:RegisterTaskDefinition");
    const ecsDeployment = parsed.Statement.find(
      (statement: { Sid?: string }) => statement.Sid === "EcsClusterAndServiceDeployment",
    );
    expect(ecsDeployment.Action).toContain("ecs:DescribeClusters");
    expect(ecsDeployment.Resource).toContain("arn:aws:ecs:us-east-2:*:cluster/starter-sandbox-*");
    // Secrets scope must match the actual secret names the core stack creates
    // (environment-scoped /<stack>/ prefix).
    expect(policy).toContain("secret:/sandbox/*");
    // KMS data-plane actions must be region-scoped, not bare "*"
    const kmsStatements = parsed.Statement.filter((s: { Action?: string[] }) =>
      s.Action?.some((a: string) => a.includes("kms:")),
    );
    const dataPlaneActions = kmsStatements.flatMap((s: { Action: string[] }) =>
      s.Action.filter((a: string) =>
        ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"].includes(a),
      ),
    );
    expect(dataPlaneActions.length).toBeGreaterThan(0);
    kmsStatements.forEach((s: { Action: string[]; Resource: string | string[] }) => {
      const hasDataAction = s.Action.some((a: string) =>
        ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"].includes(a),
      );
      if (hasDataAction) {
        expect(s.Resource).not.toBe("*");
        expect(typeof s.Resource === "string" ? s.Resource : s.Resource[0]).toContain(
          "arn:aws:kms:",
        );
      }
    });
  });

  it("exports the hosted zone id, name, name servers, and alert topic ARN", async () => {
    const output = <T>(val: pulumi.Output<T>) => new Promise<T>((res) => val.apply(res));
    expect(await output(infra.hostedZoneId)).toBeTruthy();
    expect(await output(infra.hostedZoneName)).toBe("sandbox.aws.example.com");
    expect(await output(infra.hostedZoneNameServers)).toHaveLength(4);
    expect(await output(infra.infraAlertTopicArn)).toBe(
      "arn:aws:sns:us-east-2:123456789012:starter-sandbox-infra-alerts",
    );
  });
});
