import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { validatedGithubRepo, buildAppReleaseAssumeRolePolicy } from "./bootstrap-config";
import { buildSlackNotifications } from "./chatbot";
import { poolerDnsFromEnv, type AwsEnvName } from "../env";
import {
  deploymentNames,
  resolveDeploymentIdentity,
  type AwsEnvironment,
} from "../naming";
import {
  resolveDelegatedAppHosts,
  resolveEnvApexDomain,
} from "../../shared/public-urls";

// ===========================================================================
// AWS bootstrap — per-account foundations
// ===========================================================================
// Run ONCE per AWS account (with admin credentials) before the core/apps
// stacks. Because credentials determine the target account, run each stack
// (sandbox/staging/production) while authenticated to that environment's
// account:
//
//   AWS_PROFILE=platform-sandbox pulumi up -s sandbox
//
// It codifies the three things core/apps assume already exist:
//   1. Per-app ECR repositories under the deployment-identity namespace.
//   2. A GitHub Actions OIDC provider + least-privilege deploy role.
//   3. A monthly cost budget with email alerts.
// ---------------------------------------------------------------------------

/** Image names App Runner / Lambda pull as `…/<identity>/<name>:<tag>`. */
const ECR_IMAGE_NAMES = [
  "dashboard",
  "www",
  "public-api",
  "public-mcp",
  "workers",
  "workers-lambda",
  "migrate",
] as const;

const ecrLifecyclePolicy = JSON.stringify({
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
});

const config = new pulumi.Config();
const region = new pulumi.Config("aws").get("region") ?? "us-east-2";
const stack = pulumi.getStack();

// Validate stack is a valid environment and derive pooler config
const validEnvs: AwsEnvName[] = ["sandbox", "staging", "production"];
if (!validEnvs.includes(stack as AwsEnvName)) {
  throw new Error(`Stack must be one of ${validEnvs.join(", ")}; got ${stack}.`);
}
const identity = resolveDeploymentIdentity(process.env);
const names = deploymentNames(identity, stack as AwsEnvironment);
const namePrefix = names.globalPrefix;
const accountId = aws.getCallerIdentityOutput({}).accountId;
const baseTags = {
  ...names.tags,
  Layer: "bootstrap",
};
const poolerDns = poolerDnsFromEnv(stack as AwsEnvName);

// Required "owner/repo" scope. Failing closed prevents an unscoped OIDC role
// from granting arbitrary GitHub repositories workload and state access.
const githubRepo = validatedGithubRepo(config.get("githubRepo"));
const budgetAmount = config.get("budgetAmount") ?? "100";
const budgetNotificationEmail = config.get("budgetNotificationEmail");
const complianceMode = config.get("complianceMode") ?? "none";
const isCompliant = complianceMode !== "none";
const slackTeamId = config.get("slackTeamId")?.trim();
const slackChannelId = config.get("slackChannelId")?.trim();
const slackWarningChannelId = config.get("slackWarningChannelId")?.trim();

// --- 1. ECR repositories for app images -------------------------------------
// Apps resolve images as `<account>.dkr.ecr.<region>.amazonaws.com/<identity>/<name>:<tag>`.
// A single bare identity repo is not enough — each app needs its own repository.
const ecrRepos = ECR_IMAGE_NAMES.map((imageName) => {
  const repo = new aws.ecr.Repository(`app-images-${imageName}`, {
    name: `${names.ecrNamespace}/${imageName}`,
    imageTagMutability: "MUTABLE",
    imageScanningConfiguration: { scanOnPush: true },
    encryptionConfigurations: [{ encryptionType: "AES256" }],
    tags: { ...baseTags, App: imageName },
  });
  new aws.ecr.LifecyclePolicy(`app-images-${imageName}-lifecycle`, {
    repository: repo.name,
    policy: ecrLifecyclePolicy,
  });
  return repo;
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
  name: names.deployRoleName,
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

// Narrow OIDC role for THIS repo's "Release AWS apps" workflow: push ECR images
// and roll the running services. Deliberately separate from `deployRole` above —
// per-commit releases must not carry Pulumi's fat infra permissions (RDS,
// Secrets Manager, IAM). The inline policy is attached by the apps stack, which
// is where the App Runner / Lambda resource names are known.
//
// Sandbox is local-Pulumi-only (no Actions CD), so this role is staging/production.
const appReleaseRole =
  stack === "staging" || stack === "production"
    ? new aws.iam.Role("github-app-release", {
        name: names.appReleaseRoleName,
        description:
          "Assumed by GitHub Actions (OIDC) to push ECR images and update App Runner / workers Lambda",
        assumeRolePolicy: githubOidc.arn.apply((providerArn) =>
          buildAppReleaseAssumeRolePolicy({
            providerArn,
            githubRepo,
            environment: stack as "staging" | "production",
          }),
        ),
        tags: { ...baseTags, Purpose: "app-release" },
      })
    : undefined;

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
    name: poolerDns.zoneName,
    comment: `Public delegated zone for ${stack} AWS resources`,
    tags: baseTags,
  },
  { protect: true },
);

// Public-app DNS zones (registrar keeps bare apex + mail): one zone per public
// hostname in EVERY environment. The operator adds one NS set per hostname and
// the apps stack writes Alias A + ACM records at each zone apex.
//
// `publicAppsZone` below is the legacy staging/sandbox env-apex zone. It is
// still declared during the flat-hostname transition because it is
// `protect: true` and cannot be added-and-removed in a single `pulumi up`.
const dnsRoot = process.env.AWS_DNS_ROOT_DOMAIN?.trim() ?? "";
const publicAppsApex = resolveEnvApexDomain(
  {
    base: dnsRoot,
    stagingPrefix: "staging",
    sandboxPrefix: "sandbox",
  },
  stack as AwsEnvName,
);
const publicAppsZone =
  stack !== "production" && publicAppsApex
    ? new aws.route53.Zone(
        "public-apps-zone",
        {
          name: publicAppsApex,
          comment: `Public app hostnames for ${stack} (${publicAppsApex})`,
          tags: { ...baseTags, Purpose: "public-apps" },
        },
        { protect: true },
      )
    : undefined;

const delegatedAppHosts = dnsRoot
  ? resolveDelegatedAppHosts(dnsRoot, stack as AwsEnvName)
  : [];
const publicAppHostZones = Object.fromEntries(
  delegatedAppHosts.map((entry) => [
    entry.host,
    new aws.route53.Zone(
      `public-app-host-${entry.label}`,
      {
        name: entry.host,
        comment: `Public app hostname ${entry.host} (${stack})`,
        tags: { ...baseTags, Purpose: "public-apps", App: entry.app },
      },
      { protect: true },
    ),
  ]),
) as Record<string, aws.route53.Zone>;

// The Pulumi backend lives in a dedicated state account. Its resource policies
// grant this deterministic role cross-account access; this identity policy is
// the matching workload-account half of that authorization.
const stateAccountId = process.env.AWS_STATE_ACCOUNT_ID?.trim();
const stateRegion = process.env.AWS_STATE_REGION?.trim() ?? "us-east-2";
if (!stateAccountId || !/^\d{12}$/.test(stateAccountId)) {
  throw new Error("AWS_STATE_ACCOUNT_ID must be a 12-digit account ID.");
}
if (stateRegion !== "us-east-2") {
  throw new Error("AWS_STATE_REGION must be us-east-2.");
}
const stateBucketName = `${identity.value}-${stack}-${stateAccountId}-${stateRegion}`;
const stateKmsAlias = `alias/${identity.value}-${stack}`;
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
const publicAppHostZoneArns = Object.values(publicAppHostZones).map((z) => z.arn);

new aws.iam.RolePolicy("github-deploy-access", {
  role: deployRole.name,
  policy: pulumi
    .all([
      hostedZone.arn,
      hostedZone.zoneId,
      publicAppsZone?.arn ?? pulumi.output(""),
      publicAppsZone?.zoneId ?? pulumi.output(""),
      ...publicAppHostZoneArns,
    ])
    .apply(([zoneArn, _zoneId, publicZoneArn, _publicZoneId, ...hostZoneArns]) => {
      const route53Zones = [zoneArn as string, "arn:aws:route53:::change/*"];
      if (publicZoneArn) route53Zones.unshift(publicZoneArn as string);
      for (const arn of hostZoneArns) {
        if (typeof arn === "string" && arn.length > 0) route53Zones.unshift(arn);
      }
      return JSON.stringify({
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
          Resource: route53Zones,
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
            "acm:ListTagsForCertificate",
            "acm:AddTagsToCertificate",
            "acm:RemoveTagsFromCertificate",
            "acm:UpdateCertificateOptions",
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
            "lambda:UntagResource",
            "lambda:ListTags",
            "lambda:AddPermission",
            "lambda:RemovePermission",
            "lambda:GetPolicy",
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
            "events:UntagResource",
            "events:ListTagsForResource",
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
            "logs:UntagResource",
            "logs:ListTagsForResource",
          ],
          Resource: [
            `arn:aws:logs:${region}:*:log-group:/aws/lambda/${namePrefix}-*`,
            `arn:aws:logs:${region}:*:log-group:${names.logGroupPrefix}/*`,
          ],
        },
        {
          Sid: "CloudWatchLogsList",
          Effect: "Allow",
          Action: ["logs:DescribeLogGroups"],
          Resource: "*",
        },
        {
          Sid: "CloudWatchAlarms",
          Effect: "Allow",
          Action: [
            "cloudwatch:PutMetricAlarm",
            "cloudwatch:DeleteAlarms",
            "cloudwatch:TagResource",
            "cloudwatch:UntagResource",
            "cloudwatch:ListTagsForResource",
          ],
          Resource: `arn:aws:cloudwatch:${region}:*:alarm:${namePrefix}-*`,
        },
        {
          // Cannot be narrowed. The PutCompositeAlarm API requires Resource "*".
          Sid: "CloudWatchCompositeAlarms",
          Effect: "Allow",
          Action: ["cloudwatch:PutCompositeAlarm"],
          Resource: "*",
        },
        {
          Sid: "CloudWatchAlarmRead",
          Effect: "Allow",
          Action: ["cloudwatch:DescribeAlarms"],
          Resource: "*",
        },
        {
          Sid: "SnsPublish",
          Effect: "Allow",
          Action: ["sns:Publish", "sns:GetTopicAttributes", "sns:SetTopicAttributes"],
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
          Resource: `arn:aws:secretsmanager:${region}:*:secret:${names.secretPathPrefix}/*`,
        },
        {
          Sid: "SecretsManagerList",
          Effect: "Allow",
          Action: ["secretsmanager:ListSecrets"],
          Resource: "*",
        },
        {
          Sid: "KmsKeyManagement",
          Effect: "Allow",
          Action: [
            "kms:DescribeKey",
            "kms:GetKeyPolicy",
            "kms:GetKeyRotationStatus",
            "kms:PutKeyPolicy",
            "kms:EnableKeyRotation",
            "kms:DisableKeyRotation",
            "kms:EnableKey",
            "kms:DisableKey",
            "kms:UpdateKeyDescription",
            "kms:TagResource",
            "kms:UntagResource",
            "kms:ListResourceTags",
            "kms:ScheduleKeyDeletion",
            "kms:CancelKeyDeletion",
            "kms:Encrypt",
            "kms:Decrypt",
            "kms:GenerateDataKey",
          ],
          Resource: `arn:aws:kms:${region}:*:key/*`,
        },
        {
          Sid: "KmsCreate",
          Effect: "Allow",
          Action: [
            "kms:CreateKey",
            "kms:CreateAlias",
            "kms:DeleteAlias",
            "kms:UpdateAlias",
            "kms:ListAliases",
          ],
          Resource: "*",
        },
        {
          Sid: "EcsClusterAndServiceDeployment",
          Effect: "Allow",
          Action: [
            "ecs:DeleteCluster",
            "ecs:DescribeClusters",
            "ecs:CreateService",
            "ecs:UpdateService",
            "ecs:DeleteService",
            "ecs:DescribeServices",
            "ecs:TagResource",
            "ecs:UntagResource",
            "ecs:ListTagsForResource",
          ],
          Resource: [
            `arn:aws:ecs:${region}:*:cluster/${namePrefix}-*`,
            `arn:aws:ecs:${region}:*:service/${namePrefix}-*/${namePrefix}-*`,
          ],
        },
        {
          Sid: "EcsTaskDefinitions",
          Effect: "Allow",
          Action: [
            "ecs:DeregisterTaskDefinition",
            "ecs:TagResource",
            "ecs:UntagResource",
            "ecs:ListTagsForResource",
          ],
          Resource: [`arn:aws:ecs:${region}:*:task-definition/${namePrefix}-*`],
        },
        {
          Sid: "EcsUnscopedOperations",
          Effect: "Allow",
          Action: [
            "ecs:CreateCluster",
            "ecs:RegisterTaskDefinition",
            "ecs:DescribeTaskDefinition",
            "ecs:ListClusters",
            "ecs:ListServices",
            "ecs:ListTaskDefinitions",
          ],
          Resource: "*",
        },
        {
          Sid: "IamPassRolePooler",
          Effect: "Allow",
          Action: ["iam:PassRole"],
          Resource: [
            `arn:aws:iam::*:role/${namePrefix}-pooler-*`,
            `arn:aws:iam::*:role/${namePrefix}-pgbouncer-*`,
          ],
        },
      ],
      });
    }),
});

// --- 3. Infrastructure alert topics (critical + warning) --------------------
// The core/apps stacks publish operational alerts here. Dual tiers keep staging
// visible without paging; production critical can email + Slack.
const alertTopicName = `${namePrefix}-infra-alerts`;
const alertTopicArn = pulumi.interpolate`arn:aws:sns:${region}:${accountId}:${alertTopicName}`;
const alertKey = new aws.kms.Key("infra-alerts", {
  description: `${namePrefix} infrastructure alert topic encryption key`,
  enableKeyRotation: true,
  policy: pulumi.all([accountId, alertTopicArn]).apply(([id, topicArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "AccountAdministration",
          Effect: "Allow",
          Principal: { AWS: `arn:aws:iam::${id}:root` },
          Action: "kms:*",
          Resource: "*",
        },
        {
          Sid: "AllowSnsTopicEncryption",
          Effect: "Allow",
          Principal: { Service: "sns.amazonaws.com" },
          Action: ["kms:GenerateDataKey*", "kms:Decrypt"],
          Resource: "*",
          Condition: {
            StringEquals: { "aws:SourceAccount": id },
            // Covers both the critical (`{prefix}-infra-alerts`) and warning
            // (`{prefix}-infra-alerts-warning`) topics, which share this key.
            ArnLike: {
              "aws:SourceArn": `arn:aws:sns:${region}:${id}:${namePrefix}-infra-alerts*`,
            },
          },
        },
        {
          Sid: "AllowEventBridgeEncryptedPublish",
          Effect: "Allow",
          Principal: { Service: "events.amazonaws.com" },
          Action: ["kms:GenerateDataKey*", "kms:Decrypt"],
          Resource: "*",
        },
        {
          Sid: "AllowCloudWatchEncryptedPublish",
          Effect: "Allow",
          Principal: { Service: "cloudwatch.amazonaws.com" },
          Action: ["kms:GenerateDataKey*", "kms:Decrypt"],
          Resource: "*",
          Condition: {
            StringEquals: { "aws:SourceAccount": id },
            ArnLike: {
              "aws:SourceArn": `arn:aws:cloudwatch:${region}:${id}:alarm:${namePrefix}-*`,
            },
          },
        },
      ],
    }),
  ),
  tags: baseTags,
});

new aws.kms.Alias("infra-alerts", {
  name: `alias/${namePrefix}-infra-alerts`,
  targetKeyId: alertKey.keyId,
});

const alertTopic = new aws.sns.Topic("infra-alerts", {
  name: alertTopicName,
  kmsMasterKeyId: alertKey.arn,
  tags: baseTags,
});

/**
 * Publish policy for an alert topic. Identical for both tiers: the account
 * root administers, EventBridge and CloudWatch publish, both scoped to this
 * deployment's `{prefix}-*` resources.
 */
function alertTopicPolicy(topicArn: pulumi.Input<string>) {
  return pulumi.all([accountId, topicArn]).apply(([id, arn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [
        {
          Sid: "OwnerPermissions",
          Effect: "Allow",
          Principal: { AWS: `arn:aws:iam::${id}:root` },
          Action: [
            "sns:AddPermission",
            "sns:DeleteTopic",
            "sns:GetTopicAttributes",
            "sns:ListSubscriptionsByTopic",
            "sns:Publish",
            "sns:Receive",
            "sns:RemovePermission",
            "sns:SetTopicAttributes",
            "sns:Subscribe",
          ],
          Resource: arn,
          Condition: { StringEquals: { "AWS:SourceOwner": id } },
        },
        {
          Sid: "AllowEventBridgePublish",
          Effect: "Allow",
          Principal: { Service: "events.amazonaws.com" },
          Action: "sns:Publish",
          Resource: arn,
          Condition: {
            StringEquals: { "aws:SourceAccount": id },
            ArnLike: {
              "aws:SourceArn": `arn:aws:events:${region}:${id}:rule/${namePrefix}-*`,
            },
          },
        },
        {
          Sid: "AllowCloudWatchPublish",
          Effect: "Allow",
          Principal: { Service: "cloudwatch.amazonaws.com" },
          Action: "sns:Publish",
          Resource: arn,
          Condition: {
            StringEquals: { "aws:SourceAccount": id },
            ArnLike: {
              "aws:SourceArn": `arn:aws:cloudwatch:${region}:${id}:alarm:${namePrefix}-*`,
            },
          },
        },
      ],
    }),
  );
}

new aws.sns.TopicPolicy("infra-alerts", {
  arn: alertTopic.arn,
  policy: alertTopicPolicy(alertTopic.arn),
});

const alertWarningTopic = new aws.sns.Topic("infra-alerts-warning", {
  name: `${alertTopicName}-warning`,
  kmsMasterKeyId: alertKey.arn,
  tags: baseTags,
});

new aws.sns.TopicPolicy("infra-alerts-warning", {
  arn: alertWarningTopic.arn,
  policy: alertTopicPolicy(alertWarningTopic.arn),
});

if (!slackTeamId && stack !== "sandbox") {
  pulumi.log.warn(
    `No slackTeamId for "${stack}" — the warning topic will have no subscribers` +
      (stack === "production" ? "." : ", and neither will the critical topic."),
  );
}
if (slackTeamId && !slackChannelId) {
  throw new Error("slackChannelId is required when slackTeamId is set.");
}

buildSlackNotifications({
  namePrefix,
  topicArns: { critical: alertTopic.arn, warning: alertWarningTopic.arn },
  slackTeamId,
  slackChannelId,
  slackWarningChannelId,
  tags: baseTags,
});

// Email is the interrupt channel, so it is reserved for production critical.
if (budgetNotificationEmail && stack === "production") {
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
// Registry prefix shared by every `<identity>/<name>` repository (not a single repo URL).
export const ecrRepositoryUrl = pulumi.interpolate`${accountId}.dkr.ecr.${region}.amazonaws.com/${names.ecrNamespace}`;
export const ecrRepositoryUrls = Object.fromEntries(
  ecrRepos.map((repo, i) => [ECR_IMAGE_NAMES[i], repo.repositoryUrl]),
);
export const githubOidcProviderArn = githubOidc.arn;
export const deployRoleArn = deployRole.arn;
export const regionOut = region;
export const hostedZoneId = hostedZone.zoneId;
export const hostedZoneName = hostedZone.name;
export const hostedZoneNameServers = hostedZone.nameServers;
export const publicAppsZoneId = publicAppsZone?.zoneId ?? pulumi.output("");
export const publicAppsZoneName = publicAppsZone?.name ?? pulumi.output("");
export const publicAppsZoneNameServers = publicAppsZone?.nameServers ?? pulumi.output([]);
/** Hostname → zone id / name servers for per-app NS delegation at the registrar. */
export const publicAppHostZoneIds = Object.fromEntries(
  Object.entries(publicAppHostZones).map(([host, zone]) => [host, zone.zoneId]),
);
export const publicAppHostZoneNameServers = Object.fromEntries(
  Object.entries(publicAppHostZones).map(([host, zone]) => [host, zone.nameServers]),
);
export const appReleaseRoleArn = appReleaseRole?.arn ?? pulumi.output("");
export const infraAlertTopicArn = alertTopic.arn;
/** Warning tier. Core and apps resolve this by name, not by stack reference. */
export const infraAlertWarningTopicArn = alertWarningTopic.arn;
