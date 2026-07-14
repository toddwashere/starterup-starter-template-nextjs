import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";
import {
  backendUrl,
  cloudFormationDeployArgs,
  githubDeployRoleArn,
  iamRoleArnFromCallerArn,
  nextCommands,
  resolveStateBootstrapConfig,
  retentionForEnvironment,
  secretsProviderUrl,
  stateNames,
} from "./state-orchestration";

const ENV = {
  AWS_STATE_ACCOUNT_ID: "444455556666",
  AWS_STATE_PROFILE: "starter-state",
  AWS_STATE_RESOURCE_PREFIX: "inthealth-cross-account-state",
  AWS_SANDBOX_ACCOUNT_ID: "111122223333",
};

const templatePath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../state-bootstrap/pulumi-state.cfn.yaml",
);

describe("resolveStateBootstrapConfig", () => {
  it("resolves a safe sandbox configuration from environment defaults", () => {
    expect(resolveStateBootstrapConfig(["init", "sandbox"], ENV)).toMatchObject({
      environment: "sandbox",
      region: "us-east-2",
      stateAccountId: "444455556666",
      stateProfile: "starter-state",
      workloadAccountId: "111122223333",
      workloadProfile: "starter-sandbox",
      resourcePrefix: "inthealth-cross-account-state",
    });
  });

  it("lets explicit CLI values override environment defaults", () => {
    const result = resolveStateBootstrapConfig(
      [
        "init",
        "sandbox",
        "--state-profile",
        "override-state",
        "--workload-profile=override-sandbox",
        "--resource-prefix",
        "other-state",
      ],
      ENV,
    );

    expect(result.stateProfile).toBe("override-state");
    expect(result.workloadProfile).toBe("override-sandbox");
    expect(result.resourcePrefix).toBe("other-state");
  });

  it.each([
    ["AWS_STATE_ACCOUNT_ID"],
    ["AWS_STATE_PROFILE"],
    ["AWS_STATE_RESOURCE_PREFIX"],
    ["AWS_SANDBOX_ACCOUNT_ID"],
  ])("rejects a missing required value: %s", (key) => {
    expect(() =>
      resolveStateBootstrapConfig(["init", "sandbox"], {
        ...ENV,
        [key]: "",
      }),
    ).toThrow(key);
  });

  it("rejects invalid environment and resource-prefix values", () => {
    expect(() => resolveStateBootstrapConfig(["init", "dev"], ENV)).toThrow(
      /sandbox\|staging\|production/,
    );
    expect(() =>
      resolveStateBootstrapConfig(["init", "sandbox"], {
        ...ENV,
        AWS_STATE_RESOURCE_PREFIX: "Not_S3_Safe",
      }),
    ).toThrow(/AWS_STATE_RESOURCE_PREFIX/);
    expect(() =>
      resolveStateBootstrapConfig(["init", "sandbox"], {
        ...ENV,
        AWS_STATE_REGION: "us-west-2",
      }),
    ).toThrow(/us-east-2/);
  });

  it("rejects using the state account as the workload account", () => {
    expect(() =>
      resolveStateBootstrapConfig(["init", "sandbox"], {
        ...ENV,
        AWS_SANDBOX_ACCOUNT_ID: ENV.AWS_STATE_ACCOUNT_ID,
      }),
    ).toThrow(/must differ/);
  });
});

describe("state resource derivation", () => {
  it("derives globally unique per-environment names", () => {
    expect(
      stateNames({
        environment: "sandbox",
        resourcePrefix: "inthealth-cross-account-state",
        stateAccountId: "444455556666",
        region: "us-east-2",
      }),
    ).toEqual({
      stackName: "inthealth-cross-account-state-sandbox",
      stateBucketName: "inthealth-cross-account-state-sandbox-444455556666-us-east-2",
      auditBucketName: "inthealth-cross-account-state-sandbox-audit-444455556666",
      kmsAliasName: "alias/inthealth-cross-account-state-sandbox",
      trailName: "inthealth-cross-account-state-sandbox-access",
    });
  });

  it("uses tiered state-version and audit retention", () => {
    expect(retentionForEnvironment("sandbox")).toEqual({
      stateVersionDays: 90,
      auditDays: 90,
    });
    expect(retentionForEnvironment("staging")).toEqual({
      stateVersionDays: 90,
      auditDays: 2190,
    });
    expect(retentionForEnvironment("production")).toEqual({
      stateVersionDays: 365,
      auditDays: 2190,
    });
  });
});

describe("cross-account principals and Pulumi URLs", () => {
  it("normalizes an Identity Center STS session to its IAM role ARN", () => {
    expect(
      iamRoleArnFromCallerArn(
        "arn:aws:sts::111122223333:assumed-role/AWSReservedSSO_AdministratorAccess_6b4121afd2309b8d/operator",
        "us-east-2",
      ),
    ).toBe(
      "arn:aws:iam::111122223333:role/aws-reserved/sso.amazonaws.com/us-east-2/AWSReservedSSO_AdministratorAccess_6b4121afd2309b8d",
    );
  });

  it("builds an idempotent CloudFormation deployment for the state account", () => {
    const config = resolveStateBootstrapConfig(["init", "sandbox"], ENV);
    const args = cloudFormationDeployArgs(
      config,
      "arn:aws:iam::111122223333:role/aws-reserved/sso.amazonaws.com/us-east-2/AWSReservedSSO_AdministratorAccess_example",
      "/repo/infra/aws/state-bootstrap/pulumi-state.cfn.yaml",
    );
    expect(args.slice(0, 2)).toEqual(["cloudformation", "deploy"]);
    expect(args).toContain("--no-fail-on-empty-changeset");
    expect(args).toContain("StateVersionRetentionDays=90");
    expect(args).toContain("AuditRetentionDays=90");
    expect(args).toContain("Project=inthealth-cross-account-state");
    expect(args).toContain("Environment=sandbox");
    expect(args).toContain("ManagedBy=CloudFormation");
    expect(args.some((arg) => arg.startsWith("Key="))).toBe(false);
    expect(args.join(" ")).not.toContain("pulumi stack");
  });

  it("derives the deterministic GitHub deploy role", () => {
    expect(githubDeployRoleArn("111122223333", "sandbox")).toBe(
      "arn:aws:iam::111122223333:role/starter-sandbox-github-deploy",
    );
  });

  it("builds profile-independent backend and cross-account KMS URLs", () => {
    expect(
      backendUrl("inthealth-cross-account-state-sandbox-444455556666-us-east-2", "us-east-2"),
    ).toBe(
      "s3://inthealth-cross-account-state-sandbox-444455556666-us-east-2?region=us-east-2&awssdk=v2",
    );
    expect(secretsProviderUrl("arn:aws:kms:us-east-2:444455556666:key/1234", "us-east-2")).toBe(
      "awskms:///arn:aws:kms:us-east-2:444455556666:key/1234?region=us-east-2&awssdk=v2",
    );
  });

  it("prints explicit layer commands without executing stack initialization", () => {
    const commands = nextCommands({
      environment: "sandbox",
      workloadProfile: "starter-sandbox",
      secretsProvider:
        "awskms:///arn:aws:kms:us-east-2:444455556666:key/1234?region=us-east-2&awssdk=v2",
    });

    expect(commands).toContain(
      "AWS_PROFILE=starter-sandbox pnpm infra:aws bootstrap stack init sandbox",
    );
    expect(commands).toContain("pnpm infra:aws bootstrap preview -s sandbox");
    expect(commands).toContain("pnpm infra:aws core preview -s sandbox");
    expect(commands).toContain("pnpm infra:aws apps preview -s sandbox");
  });
});

describe("pulumi state CloudFormation template", () => {
  it("retains state, audit, trail, and key resources", () => {
    const template = fs.readFileSync(templatePath, "utf8");
    expect(template.match(/DeletionPolicy: Retain/g)).toHaveLength(7);
    expect(template.match(/UpdateReplacePolicy: Retain/g)).toHaveLength(7);
  });

  it("enables versioning, KMS encryption, public blocking, and TLS enforcement", () => {
    const template = fs.readFileSync(templatePath, "utf8");
    expect(template).toContain("Status: Enabled");
    expect(template).toContain("SSEAlgorithm: aws:kms");
    expect(template).toContain("BlockPublicAcls: true");
    expect(template).toContain("aws:SecureTransport");
    expect(template).toContain("EnableKeyRotation: true");
    expect(template).toContain("Mode: COMPLIANCE");
  });

  it("limits CloudTrail data events to the state bucket", () => {
    const template = fs.readFileSync(templatePath, "utf8");
    expect(template).toContain("Type: AWS::S3::Object");
    expect(template).toContain("- !Sub arn:${AWS::Partition}:s3:::${StateBucketName}/");
    expect(template).toContain("IncludeManagementEvents: false");
  });
});
