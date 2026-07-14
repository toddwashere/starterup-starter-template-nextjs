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
    vi.stubEnv("AWS_STATE_ACCOUNT_ID", "444455556666");
    vi.stubEnv("AWS_STATE_RESOURCE_PREFIX", "inthealth-cross-account-state");
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          recorded.push({
            type: args.type,
            name: args.name,
            inputs: args.inputs,
          });
          return {
            id: `${args.name}-id`,
            state: {
              ...args.inputs,
              arn: `arn:aws:iam::123456789012:${args.name}`,
              repositoryUrl: `123456789012.dkr.ecr.us-east-2.amazonaws.com/${
                (args.inputs.name as string | undefined) ?? args.name
              }`,
            },
          };
        },
        call: (args) => args.inputs,
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

  it("provisions an ECR repository with scan-on-push", () => {
    const repos = recorded.filter((r) => r.type === "aws:ecr/repository:Repository");
    expect(repos).toHaveLength(1);
    expect(repos[0].inputs.name).toBe("starter");
    expect(repos[0].inputs.imageScanningConfiguration).toEqual({
      scanOnPush: true,
    });
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
    expect(policies).toHaveLength(1);
    const policy = await new Promise<string>((resolve) =>
      pulumi.output(policies[0].inputs.policy as string).apply(resolve),
    );
    expect(policy).toContain(
      "arn:aws:s3:::inthealth-cross-account-state-sandbox-444455556666-us-east-2",
    );
    expect(policy).toContain("arn:aws:kms:us-east-2:444455556666:key/*");
    expect(policy).toContain("alias/inthealth-cross-account-state-sandbox");
    expect(policy).not.toContain('"Resource":"*"');
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
});
