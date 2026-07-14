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
            name: (args.inputs.name as string | undefined) ?? args.name,
            arn: `arn:aws:iam::123456789012:${args.name}`,
          },
        };
      },
      call: (args) => args.inputs,
    },
    "test-project",
    "test",
  );
}

async function build() {
  vi.resetModules();
  recorded.length = 0;
  installMocks();
  const mod = await import("./vercel-access.js");
  const result = mod.buildVercelAccess({
    namePrefix: "starter-sandbox",
    vercelOidc: { teamSlug: "acme", projectName: "starter" },
    uploadsBucketArn: "arn:aws:s3:::starter-sandbox-uploads",
    jobsQueueArn: "arn:aws:sqs:us-east-2:123456789012:starter-jobs-sandbox",
    secretArns: [
      "arn:aws:secretsmanager:us-east-2:123456789012:secret:/starter/sandbox/database-url",
    ],
    bedrockRegion: "us-east-2",
    bedrockModels: ["anthropic.claude-sonnet-5"],
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  return result;
}

function out<T>(o: pulumi.Output<T>): Promise<T> {
  return new Promise<T>((res) => o.apply(res));
}

interface PolicyStatement {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
  Principal?: Record<string, string>;
  Condition?: Record<string, Record<string, string>>;
}

function statementsOf(policyJson: string): PolicyStatement[] {
  return JSON.parse(policyJson).Statement as PolicyStatement[];
}

describe("buildVercelAccess", () => {
  beforeAll(async () => {
    await build();
  }, 10000);

  it("creates an OIDC provider for the Vercel team issuer", () => {
    const providers = recorded.filter(
      (r) => r.type === "aws:iam/openIdConnectProvider:OpenIdConnectProvider",
    );
    expect(providers).toHaveLength(1);
    expect(providers[0].inputs.url).toBe("https://oidc.vercel.com/acme");
    expect(providers[0].inputs.clientIdLists).toEqual([
      "https://vercel.com/acme",
    ]);
  });

  it("scopes the trust policy to the Vercel sub claim, not a wildcard principal", async () => {
    const roles = recorded.filter((r) => r.type === "aws:iam/role:Role");
    expect(roles).toHaveLength(1);
    const trust = statementsOf(roles[0].inputs.assumeRolePolicy as string)[0];
    expect(trust.Action).toBe("sts:AssumeRoleWithWebIdentity");
    expect(trust.Principal?.Federated).toMatch(/oidc/i);
    // Never allow any federated principal / any subject.
    expect(JSON.stringify(trust.Principal)).not.toContain("*");
    const sub = trust.Condition?.StringLike?.["oidc.vercel.com/acme:sub"];
    expect(sub).toBe("owner:acme:project:starter:environment:*");
    const aud = trust.Condition?.StringEquals?.["oidc.vercel.com/acme:aud"];
    expect(aud).toBe("https://vercel.com/acme");
  });

  it("grants least-privilege access to only S3/SQS/Secrets/Bedrock", async () => {
    const policies = recorded.filter(
      (r) => r.type === "aws:iam/rolePolicy:RolePolicy",
    );
    expect(policies).toHaveLength(1);
    const statements = statementsOf(
      await out(pulumi.output(policies[0].inputs.policy as pulumi.Input<string>)),
    );
    const bySid = Object.fromEntries(statements.map((s) => [s.Sid, s]));

    // No statement may use a wildcard resource — every grant is ARN-scoped.
    for (const s of statements) {
      const resources = Array.isArray(s.Resource) ? s.Resource : [s.Resource];
      expect(resources).not.toContain("*");
    }

    expect(bySid.JobsProduce.Action).toEqual(
      expect.arrayContaining(["sqs:SendMessage"]),
    );
    // Vercel is a producer only — it must not be able to consume/delete.
    expect(JSON.stringify(bySid.JobsProduce.Action)).not.toContain(
      "DeleteMessage",
    );
    expect(bySid.AppSecretsRead.Resource).toContain(
      "arn:aws:secretsmanager:us-east-2:123456789012:secret:/starter/sandbox/database-url",
    );
    expect(bySid.BedrockInvoke.Resource).toEqual([
      "arn:aws:bedrock:us-east-2::foundation-model/anthropic.claude-sonnet-5",
    ]);
    expect(bySid.UploadsObjects.Resource).toMatch(/uploads\/\*$/);
  });

  it("returns the role ARN for wiring into Vercel", async () => {
    const result = await build();
    expect(await out(result.roleArn)).toMatch(/^arn:aws:iam::/);
  });
});
