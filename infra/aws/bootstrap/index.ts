import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { validatedGithubRepo } from "./bootstrap-config";
import { poolerConfigFromEnv, type AwsEnvName } from "../env";

// ===========================================================================
// AWS bootstrap — per-account foundations
// ===========================================================================
// Run ONCE per AWS account (with admin credentials) before the core/apps
// stacks. Because credentials determine the target account, run each stack
// (sandbox/staging/production) while authenticated to that environment's
// account:
//
//   AWS_PROFILE=starter-sandbox pulumi up -s sandbox
//
// It codifies the three things core/apps assume already exist:
//   1. An ECR repository for app images.
//   2. A GitHub Actions OIDC provider + least-privilege deploy role.
//   3. A monthly cost budget with email alerts.
// ---------------------------------------------------------------------------

const config = new pulumi.Config();
const region = new pulumi.Config("aws").get("region") ?? "us-east-2";
const stack = pulumi.getStack();
const namePrefix = `starter-${stack}`;
const baseTags = {
  Project: "starter",
  Stack: stack,
  ManagedBy: "pulumi",
  Layer: "bootstrap",
};

// Validate stack is a valid environment and derive pooler config
const validEnvs: AwsEnvName[] = ["sandbox", "staging", "production"];
if (!validEnvs.includes(stack as AwsEnvName)) {
  throw new Error(`Stack must be one of ${validEnvs.join(", ")}; got ${stack}.`);
}
const poolerConfig = poolerConfigFromEnv(stack as AwsEnvName);

// Required "owner/repo" scope. Failing closed prevents an unscoped OIDC role
// from granting arbitrary GitHub repositories workload and state access.
const githubRepo = validatedGithubRepo(config.get("githubRepo"));
const budgetAmount = config.get("budgetAmount") ?? "100";
const budgetNotificationEmail = config.get("budgetNotificationEmail");
const complianceMode = config.get("complianceMode") ?? "none";
const isCompliant = complianceMode !== "none";

// --- 1. ECR repository for app images ---------------------------------------
const ecr = new aws.ecr.Repository("app-images", {
  name: "starter",
  imageTagMutability: "MUTABLE",
  imageScanningConfiguration: { scanOnPush: true },
  encryptionConfigurations: [{ encryptionType: "AES256" }],
  tags: baseTags,
});

// Keep only the most recent images to bound storage cost.
new aws.ecr.LifecyclePolicy("app-images-lifecycle", {
  repository: ecr.name,
  policy: JSON.stringify({
    rules: [
      {
        rulePriority: 1,
        description: "Keep last 20 images",
        selection: {
          tagStatus: "any",
          countType: "imageCountMoreThan",
          countNumber: 20,
        },
        action: { type: "expire" },
      },
    ],
  }),
});

// --- 2. GitHub Actions OIDC provider + deploy role --------------------------
// One provider per account (keyed by the issuer URL). CI assumes the deploy
// role via OIDC — no long-lived AWS access keys are stored in GitHub.
const githubOidc = new aws.iam.OpenIdConnectProvider("github-oidc", {
  url: "https://token.actions.githubusercontent.com",
  clientIdLists: ["sts.amazonaws.com"],
  // AWS validates the GitHub issuer's certificate chain automatically for this
  // well-known provider; this is the current GitHub Actions root thumbprint.
  thumbprintLists: ["6938fd4d98bab03faadb97b34396831e3780aea1"],
  tags: baseTags,
});

const deployRole = new aws.iam.Role("github-deploy", {
  name: `${namePrefix}-github-deploy`,
  description: "Assumed by GitHub Actions (OIDC) to deploy the core + apps stacks",
  assumeRolePolicy: githubOidc.arn.apply((providerArn) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Principal: { Federated: providerArn },
          Action: "sts:AssumeRoleWithWebIdentity",
          Condition: {
            StringEquals: {
              "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
            },
            // Scope to the specific repo (any branch/tag/PR). Tighten to
            // `repo:<owner>/<repo>:ref:refs/heads/main` for prod-only accounts.
            StringLike: {
              "token.actions.githubusercontent.com:sub": `repo:${githubRepo}:*`,
            },
          },
        },
      ],
    }),
  ),
  tags: baseTags,
});

// Managed policies the deploy role needs (mirrors infra/aws/README.md). The
// compliance set is only attached when complianceMode != none. IAMFullAccess is
// broad — narrow it to a custom role/policy-management policy for stricter
// accounts.
const BASE_POLICIES = [
  "AWSAppRunnerFullAccess",
  "AWSLambda_FullAccess",
  "AmazonRDSFullAccess",
  "AmazonSQSFullAccess",
  "SecretsManagerReadWrite",
  "AmazonEC2ContainerRegistryPowerUser",
  "AmazonS3FullAccess",
  "AmazonEC2FullAccess",
  "IAMFullAccess",
];
const COMPLIANCE_POLICIES = [
  "AWSKeyManagementServicePowerUser",
  "AWSCloudTrail_FullAccess",
  "AWSWAFFullAccess",
  "AWSConfigUserAccess",
];

const deployPolicies = [...BASE_POLICIES, ...(isCompliant ? COMPLIANCE_POLICIES : [])];
deployPolicies.forEach((policyName, i) => {
  new aws.iam.RolePolicyAttachment(`deploy-policy-${i}`, {
    role: deployRole.name,
    policyArn: `arn:aws:iam::aws:policy/${policyName}`,
  });
});

// --- 2a. Delegated hosted zone for environment resources --------------------
// The core stack will configure Route 53 records for the pooler endpoint and
// ACM certificates within this zone. Operators must manually delegate this zone
// from the root domain's authoritative DNS.
const hostedZone = new aws.route53.Zone(
  "delegated-zone",
  {
    name: poolerConfig.zoneName,
    comment: `Public delegated zone for ${stack} AWS resources`,
    tags: baseTags,
  },
  { protect: true },
);

// The Pulumi backend lives in a dedicated state account. Its resource policies
// grant this deterministic role cross-account access; this identity policy is
// the matching workload-account half of that authorization.
const stateAccountId = process.env.AWS_STATE_ACCOUNT_ID?.trim();
const stateResourcePrefix = process.env.AWS_STATE_RESOURCE_PREFIX?.trim();
const stateRegion = process.env.AWS_STATE_REGION?.trim() ?? "us-east-2";
if (!stateAccountId || !/^\d{12}$/.test(stateAccountId)) {
  throw new Error("AWS_STATE_ACCOUNT_ID must be a 12-digit account ID.");
}
if (
  !stateResourcePrefix ||
  stateResourcePrefix.length > 29 ||
  !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(stateResourcePrefix)
) {
  throw new Error("AWS_STATE_RESOURCE_PREFIX must be 1-29 lowercase letters, numbers, or hyphens.");
}
if (stateRegion !== "us-east-2") {
  throw new Error("AWS_STATE_REGION must be us-east-2.");
}
const stateBucketName = `${stateResourcePrefix}-${stack}-${stateAccountId}-${stateRegion}`;
const stateKmsAlias = `alias/${stateResourcePrefix}-${stack}`;
new aws.iam.RolePolicy("github-state-access", {
  role: deployRole.name,
  policy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [
      {
        Sid: "PulumiStateBucket",
        Effect: "Allow",
        Action: ["s3:ListBucket"],
        Resource: [`arn:aws:s3:::${stateBucketName}`],
      },
      {
        Sid: "PulumiStateObjects",
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"],
        Resource: [`arn:aws:s3:::${stateBucketName}/*`],
      },
      {
        Sid: "PulumiStateKms",
        Effect: "Allow",
        Action: [
          "kms:Decrypt",
          "kms:DescribeKey",
          "kms:Encrypt",
          "kms:GenerateDataKey",
          "kms:GenerateDataKeyWithoutPlaintext",
          "kms:ReEncryptFrom",
          "kms:ReEncryptTo",
        ],
        Resource: [`arn:aws:kms:${stateRegion}:${stateAccountId}:key/*`],
        Condition: {
          "ForAnyValue:StringEquals": {
            "kms:ResourceAliases": stateKmsAlias,
          },
        },
      },
    ],
  }),
});

// The core stack needs least-privilege access to Route 53, ACM, Lambda,
// EventBridge, CloudWatch, SNS, Secrets Manager, KMS, and ECS for the pooler
// deployment. Scope resource-level permissions where AWS supports them.
new aws.iam.RolePolicy("github-deploy-access", {
  role: deployRole.name,
  policy: pulumi.all([hostedZone.arn, hostedZone.zoneId]).apply(([zoneArn, zoneId]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "Route53RecordChanges",
          Effect: "Allow",
          Action: [
            "route53:ChangeResourceRecordSets",
            "route53:GetChange",
            "route53:ListResourceRecordSets",
          ],
          Resource: [zoneArn, "arn:aws:route53:::change/*"],
        },
        {
          Sid: "Route53HostedZoneRead",
          Effect: "Allow",
          Action: ["route53:GetHostedZone", "route53:ListHostedZones"],
          Resource: "*",
        },
        {
          Sid: "AcmCertificateManagement",
          Effect: "Allow",
          Action: [
            "acm:RequestCertificate",
            "acm:DescribeCertificate",
            "acm:GetCertificate",
            "acm:ListCertificates",
            "acm:AddTagsToCertificate",
            "acm:DeleteCertificate",
            "acm:ExportCertificate",
          ],
          Resource: "*",
        },
        {
          Sid: "LambdaFunctions",
          Effect: "Allow",
          Action: [
            "lambda:CreateFunction",
            "lambda:UpdateFunctionCode",
            "lambda:UpdateFunctionConfiguration",
            "lambda:GetFunction",
            "lambda:DeleteFunction",
            "lambda:InvokeFunction",
            "lambda:TagResource",
            "lambda:AddPermission",
            "lambda:RemovePermission",
          ],
          Resource: `arn:aws:lambda:${region}:*:function:${namePrefix}-*`,
        },
        {
          Sid: "LambdaList",
          Effect: "Allow",
          Action: ["lambda:ListFunctions"],
          Resource: "*",
        },
        {
          Sid: "EventBridgeRules",
          Effect: "Allow",
          Action: [
            "events:PutRule",
            "events:DeleteRule",
            "events:DescribeRule",
            "events:EnableRule",
            "events:DisableRule",
            "events:PutTargets",
            "events:RemoveTargets",
            "events:ListTargetsByRule",
            "events:TagResource",
          ],
          Resource: `arn:aws:events:${region}:*:rule/${namePrefix}-*`,
        },
        {
          Sid: "CloudWatchLogs",
          Effect: "Allow",
          Action: [
            "logs:CreateLogGroup",
            "logs:DeleteLogGroup",
            "logs:DescribeLogGroups",
            "logs:PutRetentionPolicy",
            "logs:TagResource",
          ],
          Resource: `arn:aws:logs:${region}:*:log-group:/aws/lambda/${namePrefix}-*`,
        },
        {
          Sid: "CloudWatchLogsList",
          Effect: "Allow",
          Action: ["logs:DescribeLogGroups"],
          Resource: "*",
        },
        {
          Sid: "SnsPublish",
          Effect: "Allow",
          Action: ["sns:Publish", "sns:GetTopicAttributes"],
          Resource: `arn:aws:sns:${region}:*:${namePrefix}-*`,
        },
        {
          Sid: "SecretsManager",
          Effect: "Allow",
          Action: [
            "secretsmanager:CreateSecret",
            "secretsmanager:GetSecretValue",
            "secretsmanager:DescribeSecret",
            "secretsmanager:PutSecretValue",
            "secretsmanager:DeleteSecret",
            "secretsmanager:TagResource",
          ],
          Resource: `arn:aws:secretsmanager:${region}:*:secret:${namePrefix}/*`,
        },
        {
          Sid: "SecretsManagerList",
          Effect: "Allow",
          Action: ["secretsmanager:ListSecrets"],
          Resource: "*",
        },
        {
          Sid: "KmsKeys",
          Effect: "Allow",
          Action: [
            "kms:CreateKey",
            "kms:DescribeKey",
            "kms:GetKeyPolicy",
            "kms:PutKeyPolicy",
            "kms:EnableKeyRotation",
            "kms:TagResource",
            "kms:CreateAlias",
            "kms:DeleteAlias",
            "kms:UpdateAlias",
            "kms:ScheduleKeyDeletion",
            "kms:Encrypt",
            "kms:Decrypt",
            "kms:GenerateDataKey",
          ],
          Resource: "*",
        },
        {
          Sid: "EcsServiceDeployment",
          Effect: "Allow",
          Action: [
            "ecs:CreateService",
            "ecs:UpdateService",
            "ecs:DeleteService",
            "ecs:DescribeServices",
            "ecs:RegisterTaskDefinition",
            "ecs:DeregisterTaskDefinition",
            "ecs:DescribeTaskDefinition",
            "ecs:TagResource",
          ],
          Resource: [
            `arn:aws:ecs:${region}:*:service/${namePrefix}-*`,
            `arn:aws:ecs:${region}:*:task-definition/${namePrefix}-*`,
          ],
        },
        {
          Sid: "EcsList",
          Effect: "Allow",
          Action: ["ecs:ListServices", "ecs:ListTaskDefinitions"],
          Resource: "*",
        },
        {
          Sid: "IamPassRolePooler",
          Effect: "Allow",
          Action: ["iam:PassRole"],
          Resource: `arn:aws:iam::*:role/${namePrefix}-pooler-*`,
        },
      ],
    }),
  ),
});

// --- 3. Infrastructure alert topic ------------------------------------------
// The core stack publishes operational alerts (certificate expiry, pooler
// health) to this SNS topic. Subscribe additional endpoints (PagerDuty, Slack)
// as needed.
const alertTopic = new aws.sns.Topic("infra-alerts", {
  name: `${namePrefix}-infra-alerts`,
  kmsMasterKeyId: "alias/aws/sns",
  tags: baseTags,
});

if (budgetNotificationEmail) {
  new aws.sns.TopicSubscription("infra-alerts-email", {
    topic: alertTopic.arn,
    protocol: "email",
    endpoint: budgetNotificationEmail,
  });
}

// --- 4. Monthly cost budget + alerts ----------------------------------------
// Runaway RDS/NAT cost is the biggest sandbox risk. Alerts require an email; the
// budget itself is created regardless so cost is always tracked.
if (budgetNotificationEmail) {
  new aws.budgets.Budget("monthly-budget", {
    name: `${namePrefix}-budget`,
    budgetType: "COST",
    limitAmount: budgetAmount,
    limitUnit: "USD",
    timeUnit: "MONTHLY",
    notifications: [
      {
        comparisonOperator: "GREATER_THAN",
        threshold: 80,
        thresholdType: "PERCENTAGE",
        notificationType: "ACTUAL",
        subscriberEmailAddresses: [budgetNotificationEmail],
      },
      {
        comparisonOperator: "GREATER_THAN",
        threshold: 100,
        thresholdType: "PERCENTAGE",
        notificationType: "FORECASTED",
        subscriberEmailAddresses: [budgetNotificationEmail],
      },
    ],
  });
}

// --- Exports ----------------------------------------------------------------
// Feed these into GitHub Actions (AWS_DEPLOY_ROLE_ARN, AWS_ECR_REGISTRY) and the
// apps stack's `imageRegistry` config.
export const ecrRepositoryUrl = ecr.repositoryUrl;
export const githubOidcProviderArn = githubOidc.arn;
export const deployRoleArn = deployRole.arn;
export const regionOut = region;
export const hostedZoneId = hostedZone.zoneId;
export const hostedZoneName = hostedZone.name;
export const hostedZoneNameServers = hostedZone.nameServers;
export const infraAlertTopicArn = alertTopic.arn;
