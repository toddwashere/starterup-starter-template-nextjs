import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export type AppReleaseDeployPolicyArgs = {
  accountId: string;
  region: string;
  /** ECR namespace, i.e. the deployment identity (`platform`). */
  ecrNamespace: string;
  /** Environment-scoped resource prefix, e.g. `platform-staging`. */
  namePrefix: string;
};

/**
 * Narrow policy for the app-release role (this repo's OIDC "Release AWS apps"
 * workflow): push images to the identity's ECR repositories, then roll the
 * running App Runner services and the workers Lambda.
 *
 * This role deliberately CANNOT read secrets, reach RDS/SQS/S3, or edit IAM —
 * Pulumi's fat `github-deploy` role owns infra shape and runs dispatch-only.
 * Widening this document widens the blast radius of every per-commit release.
 */
export function buildAppReleaseDeployPolicyDocument(args: AppReleaseDeployPolicyArgs): string {
  const { accountId, region, ecrNamespace, namePrefix } = args;
  const ecrRepoArnPrefix = `arn:aws:ecr:${region}:${accountId}:repository/${ecrNamespace}`;

  return JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        // Account-level by definition — ECR has no resource for the auth token.
        Sid: "EcrAuth",
        Effect: "Allow",
        Action: ["ecr:GetAuthorizationToken"],
        Resource: "*",
      },
      {
        Sid: "EcrPushPull",
        Effect: "Allow",
        Action: [
          "ecr:BatchCheckLayerAvailability",
          "ecr:GetDownloadUrlForLayer",
          "ecr:BatchGetImage",
          "ecr:PutImage",
          "ecr:InitiateLayerUpload",
          "ecr:UploadLayerPart",
          "ecr:CompleteLayerUpload",
          "ecr:DescribeRepositories",
          "ecr:DescribeImages",
        ],
        Resource: [`${ecrRepoArnPrefix}/*`],
      },
      {
        // App Runner service ARNs embed an opaque per-service id that Pulumi
        // generates, so they cannot be predicted at policy-build time. The
        // actions are read/roll only — no Create/Delete/Pause.
        Sid: "AppRunnerRelease",
        Effect: "Allow",
        Action: [
          "apprunner:ListServices",
          "apprunner:DescribeService",
          "apprunner:UpdateService",
          "apprunner:StartDeployment",
          "apprunner:ListOperations",
        ],
        Resource: "*",
      },
      {
        // `apprunner:UpdateService` re-sends the whole SourceConfiguration,
        // including AuthenticationConfiguration.AccessRoleArn, so App Runner
        // must be allowed to receive that role. Scoped by both the role-name
        // pattern the apps stack auto-names and the receiving service.
        Sid: "PassAppRunnerEcrAccessRole",
        Effect: "Allow",
        Action: ["iam:PassRole"],
        Resource: [`arn:aws:iam::${accountId}:role/apprunner-ecr-access-*`],
        // NO `iam:PassedToService` condition, deliberately. Three attempts
        // against real App Runner (staging public-api, 2026-07-25) established:
        //   - `StringEquals: build.apprunner.amazonaws.com`      -> denied
        //   - `StringEqualsIfExists` with build.*/tasks.*        -> denied
        //   - simulate-principal-policy with a WRONG value        -> implicitDeny
        // The third proves the condition itself is what blocks, so UpdateService
        // sends some value outside that set. Guessing a fourth string is not a
        // strategy.
        //
        // Dropping it is safe because the PASSED role constrains itself: the
        // trust policy on `apprunner-ecr-access-*` allows ONLY
        // `build.apprunner.amazonaws.com` to assume it (verified in-account), so
        // handing that role to any other service is inert — nothing else can
        // assume it. Combined with the pinned Resource above, this grants the
        // ability to pass exactly one purpose-built role to the one service that
        // can use it.
        //
        // NOTE: simulate-principal-policy is unreliable here. It reported
        // "allowed" while the live call denied, because a simulation without the
        // context key cannot reproduce a request that supplies one.
      },
      {
        Sid: "LambdaImageUpdate",
        Effect: "Allow",
        Action: [
          "lambda:UpdateFunctionCode",
          "lambda:GetFunction",
          "lambda:GetFunctionConfiguration",
        ],
        Resource: [
          `arn:aws:lambda:${region}:${accountId}:function:${namePrefix}-workers`,
          `arn:aws:lambda:${region}:${accountId}:function:${namePrefix}-migrate`,
        ],
      },
      {
        // The migration gate invokes this one function. Deliberately NOT
        // extended to `-workers`: invoking that would let a release inject
        // arbitrary jobs into the queue consumer.
        Sid: "InvokeMigrateLambda",
        Effect: "Allow",
        Action: ["lambda:InvokeFunction"],
        Resource: [
          `arn:aws:lambda:${region}:${accountId}:function:${namePrefix}-migrate`,
        ],
      },
    ],
  });
}

export type AttachAppReleaseDeployPolicyArgs = {
  namePrefix: string;
  /** Bootstrap app-release role name (or id). */
  deployRoleName: pulumi.Input<string>;
  accountId: pulumi.Input<string>;
  region: string;
  ecrNamespace: string;
};

/** Attach the ECR-push / service-roll inline policy to the app-release role. */
export function attachAppReleaseDeployPolicy(
  args: AttachAppReleaseDeployPolicyArgs,
): aws.iam.RolePolicy {
  const { namePrefix, deployRoleName, accountId, region, ecrNamespace } = args;
  const policyName = `${namePrefix}-app-release-deploy`;

  return new aws.iam.RolePolicy(policyName, {
    role: deployRoleName,
    name: policyName,
    policy: pulumi.all([accountId]).apply(([resolvedAccountId]) =>
      buildAppReleaseDeployPolicyDocument({
        accountId: resolvedAccountId,
        region,
        ecrNamespace,
        namePrefix,
      }),
    ),
  });
}

/** Extract IAM role name from a role ARN (`…:role/name`). */
export function roleNameFromArn(roleArn: string): string {
  const name = roleArn.split("/").pop();
  if (!name) {
    throw new Error(`Invalid IAM role ARN: ${roleArn}`);
  }
  return name;
}
