import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

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

// "owner/repo" — scopes the deploy role trust policy to your repository. Without
// it the role + provider are still created, but the role trusts no repo (so it
// can't be assumed until you set this and re-run).
const githubRepo = config.get("githubRepo");
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
            ...(githubRepo
              ? {
                  StringLike: {
                    "token.actions.githubusercontent.com:sub": `repo:${githubRepo}:*`,
                  },
                }
              : {}),
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

const deployPolicies = [
  ...BASE_POLICIES,
  ...(isCompliant ? COMPLIANCE_POLICIES : []),
];
deployPolicies.forEach((policyName, i) => {
  new aws.iam.RolePolicyAttachment(`deploy-policy-${i}`, {
    role: deployRole.name,
    policyArn: `arn:aws:iam::aws:policy/${policyName}`,
  });
});

// --- 3. Monthly cost budget + alerts ----------------------------------------
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
