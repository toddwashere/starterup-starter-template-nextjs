import { describe, expect, it } from "vitest";
import { buildAppReleaseDeployPolicyDocument } from "./deploy-app-release-iam";

const ARGS = {
  accountId: "123456789012",
  region: "us-east-2",
  ecrNamespace: "platform",
  namePrefix: "platform-staging",
};

interface Statement {
  Sid?: string;
  Effect: string;
  Action: string[];
  Resource: string | string[];
  Condition?: Record<string, Record<string, string | string[]>>;
}

function statements(): Statement[] {
  return (
    JSON.parse(buildAppReleaseDeployPolicyDocument(ARGS)) as {
      Statement: Statement[];
    }
  ).Statement;
}

function statement(sid: string): Statement {
  const found = statements().find((s) => s.Sid === sid);
  if (!found) throw new Error(`no statement with Sid "${sid}"`);
  return found;
}

describe("buildAppReleaseDeployPolicyDocument", () => {
  it("allows the ECR push handshake scoped to the identity namespace", () => {
    const push = statement("EcrPushPull");
    expect(push.Action).toEqual(
      expect.arrayContaining([
        "ecr:BatchCheckLayerAvailability",
        "ecr:InitiateLayerUpload",
        "ecr:UploadLayerPart",
        "ecr:CompleteLayerUpload",
        "ecr:PutImage",
      ]),
    );
    expect(push.Resource).toEqual(["arn:aws:ecr:us-east-2:123456789012:repository/platform/*"]);

    // GetAuthorizationToken is account-level and cannot be resource-scoped;
    // keep it in its own statement so the push grant stays repo-scoped.
    const auth = statement("EcrAuth");
    expect(auth.Action).toEqual(["ecr:GetAuthorizationToken"]);
    expect(auth.Resource).toBe("*");
  });

  it("allows rolling App Runner services", () => {
    const release = statement("AppRunnerRelease");
    expect(release.Action).toEqual(
      expect.arrayContaining([
        "apprunner:DescribeService",
        "apprunner:UpdateService",
        "apprunner:ListServices",
        "apprunner:ListOperations",
      ]),
    );
  });

  it("scopes the Lambda image update to this stack's two functions", () => {
    const lambda = statement("LambdaImageUpdate");
    expect(lambda.Action).toEqual(
      expect.arrayContaining(["lambda:UpdateFunctionCode", "lambda:GetFunction"]),
    );
    expect([...(lambda.Resource as string[])].sort()).toEqual([
      "arn:aws:lambda:us-east-2:123456789012:function:platform-staging-migrate",
      "arn:aws:lambda:us-east-2:123456789012:function:platform-staging-workers",
    ]);
    // A bare `function:*` would let a release replace the code of any Lambda
    // in the account, including core's pooler helpers.
    for (const resource of lambda.Resource as string[]) {
      expect(resource).not.toContain("*");
    }
  });

  it("allows invoking the migrate Lambda and nothing else", () => {
    const invoke = statement("InvokeMigrateLambda");
    expect(invoke.Action).toEqual(["lambda:InvokeFunction"]);
    expect(invoke.Resource).toEqual([
      "arn:aws:lambda:us-east-2:123456789012:function:platform-staging-migrate",
    ]);
    // Invoking the workers Lambda would let a release inject arbitrary jobs
    // into the queue consumer.
    expect(JSON.stringify(invoke)).not.toContain("workers");
  });

  it("scopes PassRole to the App Runner ECR-access role and service", () => {
    // apprunner:UpdateService needs iam:PassRole because the merged
    // SourceConfiguration carries AuthenticationConfiguration.AccessRoleArn.
    const pass = statement("PassAppRunnerEcrAccessRole");
    expect(pass.Action).toEqual(["iam:PassRole"]);
    expect(pass.Resource).toEqual(["arn:aws:iam::123456789012:role/apprunner-ecr-access-*"]);

    // MUST have no iam:PassedToService condition. Both StringEquals and
    // StringEqualsIfExists were tried against real App Runner and both denied
    // every service roll — UpdateService sends a value outside the documented
    // set. Safety comes from the passed role's own trust policy, which admits
    // only build.apprunner.amazonaws.com, plus the pinned Resource above.
    // Re-adding a condition here breaks all four App Runner services.
    expect(pass.Condition).toBeUndefined();
  });

  it("grants no data-plane or infra-shape access", () => {
    const raw = buildAppReleaseDeployPolicyDocument(ARGS);
    // The whole point of the thin role: a compromised release job must not be
    // able to read app secrets, touch the database, or edit IAM.
    expect(raw).not.toMatch(/secretsmanager:GetSecretValue/);
    expect(raw).not.toMatch(/rds:/);
    expect(raw).not.toMatch(/"iam:\*"/);
    expect(raw).not.toMatch(/sqs:/);
    expect(raw).not.toMatch(/s3:/);
    expect(raw).not.toMatch(/bedrock:/);
  });

  it("never grants a bare wildcard resource without an action that requires it", () => {
    const WILDCARD_OK = new Set(["EcrAuth", "AppRunnerRelease"]);
    for (const s of statements()) {
      if (s.Resource === "*") {
        expect(WILDCARD_OK.has(s.Sid ?? "")).toBe(true);
      }
    }
  });

  it("tracks the name prefix and region it is built for", () => {
    const other = JSON.parse(
      buildAppReleaseDeployPolicyDocument({
        ...ARGS,
        region: "us-west-2",
        namePrefix: "platform-production",
        ecrNamespace: "platform",
      }),
    ) as { Statement: Statement[] };
    const lambda = other.Statement.find((s) => s.Sid === "LambdaImageUpdate");
    expect([...(lambda?.Resource as string[])].sort()).toEqual([
      "arn:aws:lambda:us-west-2:123456789012:function:platform-production-migrate",
      "arn:aws:lambda:us-west-2:123456789012:function:platform-production-workers",
    ]);
  });
});
