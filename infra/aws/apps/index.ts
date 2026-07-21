import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

import { config as sandboxConfig } from "../config.sandbox";
import { config as stagingConfig } from "../config.staging";
import { config as productionConfig } from "../config.production";
import { coreStackRefFromEnv } from "../env";
import { deploymentNames, resolveDeploymentIdentity, type AwsEnvironment } from "../naming";
import { resolveCompliance } from "../../shared/compliance";
import { secretsForApp } from "../../shared/secret-catalog";
import { appRunnerInstanceSecretArns, workersRuntimeSecretIds } from "./app-secrets";

// --- Config loading ---------------------------------------------------------
// Mirror the core stack exactly: import all per-stack configs statically and
// select by stack name.  A dynamic template import is fragile under the Pulumi
// TS runtime's module resolution, so we pick from a static map.
const CONFIGS = {
  sandbox: sandboxConfig,
  staging: stagingConfig,
  production: productionConfig,
} as const;

const stack = pulumi.getStack();
const env = stack as keyof typeof CONFIGS;
const cfg = CONFIGS[env] ?? sandboxConfig;

const config = new pulumi.Config();

// The core stack reference is derived from PULUMI_ORG (infra/.env.local) instead
// of committed stack config: `<org>/starter-aws-core/<env>`.
const coreStackRef = coreStackRefFromEnv(env);

// The ECR registry URL is derived from the *deploy* account (getCallerIdentity)
// and region, so no account-id-bearing value lives in committed stack config.
const registryAccountId = aws.getCallerIdentityOutput({}).accountId;

// CI passes the deploy-time image tag via `pulumi up --config imageTag=<sha>`
// (see .github/workflows/deploy-aws.yml). Honor that override first so App
// Runner/Lambda reference the SHA-tagged images CI actually pushed; fall back
// to the env config's tag for local/default deploys.
const imageTag = config.get("imageTag") ?? cfg.apps.imageTag;

// The AWS provider reads `aws:region` from stack config; fall back to the env
// config's region so both stay in sync (kept identical to core).
const region = new pulumi.Config("aws").get("region") ?? cfg.aws.region;

const identity = resolveDeploymentIdentity(process.env);
const names = deploymentNames(identity, stack as AwsEnvironment);

// ECR registry URL: `<account>.dkr.ecr.<region>.amazonaws.com/<identity>`.
const imageRegistry = pulumi.interpolate`${registryAccountId}.dkr.ecr.${region}.amazonaws.com/${names.ecrNamespace}`;

const namePrefix = names.globalPrefix;
const baseTags = { ...names.tags, Layer: "apps" };

// --- Compliance -------------------------------------------------------------
// Derive per-feature flags from the coarse complianceMode.  cloudArmor gates
// WAF association on public services; cmek gates the KMS decrypt grants that
// let workloads read CMEK-encrypted secrets.
const compliance = resolveCompliance(cfg.complianceMode);

// --- Core stack outputs (StackReference) ------------------------------------
const coreStack = new pulumi.StackReference(coreStackRef);
const privateSubnetIds = coreStack.getOutput("privateSubnetIds");
const appSecurityGroupId = coreStack.getOutput("appSecurityGroupId");
const databaseUrlSecretArn = coreStack.getOutput("databaseUrlSecretArn");
const directUrlSecretArn = coreStack.getOutput("directUrlSecretArn");
const sqsQueueUrl = coreStack.getOutput("sqsQueueUrl");
const sqsQueueArn = coreStack.getOutput("sqsQueueArn");
const uploadsBucket = coreStack.getOutput("uploadsBucket");
// NOTE: core's buildComplianceResources does NOT yet export a WebACL ARN, so
// this output currently resolves to `undefined` and every WAF association below
// is a guarded no-op.  See the CONCERN in the task report.
const wafWebAclArn = coreStack.getOutput("wafWebAclArn");
// catalog id -> Secrets Manager ARN for every SECRET_CATALOG entry except
// `database-url` (core derives that one separately, above).
const catalogSecretArns = coreStack.getOutput("catalogSecretArns") as pulumi.Output<
  Record<string, string>
>;

/** Resolve one catalog secret id to its ARN as a Pulumi output. */
function secretArnOutput(id: string): pulumi.Output<string> {
  if (id === "database-url") return databaseUrlSecretArn as pulumi.Output<string>;
  return catalogSecretArns.apply((map) => {
    const arn = (map ?? {})[id];
    if (!arn) throw new Error(`Missing catalogSecretArns[${id}]`);
    return arn;
  });
}

// S3 ARNs are derived from the bucket NAME the core stack exports.
const uploadsBucketArn = pulumi.interpolate`arn:aws:s3:::${uploadsBucket}`;
const uploadsObjectsArn = pulumi.interpolate`arn:aws:s3:::${uploadsBucket}/*`;

// KMS decrypt statement (only when CMEK is on) so instance/lambda roles can read
// CMEK-encrypted Secrets Manager secrets.  Scoped via the secretsmanager
// ViaService condition rather than a specific key ARN (core owns the key).
const kmsDecryptStatements = compliance.cmek
  ? [
      {
        Effect: "Allow",
        Action: ["kms:Decrypt"],
        Resource: "*",
        Condition: {
          StringEquals: {
            "kms:ViaService": `secretsmanager.${region}.amazonaws.com`,
          },
        },
      },
    ]
  : [];

// Bedrock InvokeModel, scoped to the configured foundation models. Applied to
// the App Runner instance role and the workers Lambda role so server-side AI
// calls work from either runtime.
const bedrockStatements =
  cfg.ai.bedrockModels.length > 0
    ? [
        {
          Effect: "Allow",
          Action: ["bedrock:InvokeModel", "bedrock:InvokeModelWithResponseStream"],
          Resource: cfg.ai.bedrockModels.map(
            (model) => `arn:aws:bedrock:${cfg.ai.bedrockRegion}::foundation-model/${model}`,
          ),
        },
      ]
    : [];

// ===========================================================================
// App Runner: dashboard, www, public-api, public-mcp
// ===========================================================================

// Shared VPC connector: all services egress through the private subnets +
// app security group so they can reach the RDS Proxy / SQS via the VPC.
const vpcConnector = new aws.apprunner.VpcConnector("apps-vpc-connector", {
  vpcConnectorName: `${namePrefix}-connector`,
  subnets: privateSubnetIds,
  securityGroups: [appSecurityGroupId],
  tags: baseTags,
});

// Shared autoscaling config: sizing comes straight from cfg.apps.
const autoScaling = new aws.apprunner.AutoScalingConfigurationVersion("apps-autoscaling", {
  autoScalingConfigurationName: `${namePrefix}-asc`,
  minSize: cfg.apps.minSize,
  maxSize: cfg.apps.maxSize,
  maxConcurrency: cfg.apps.maxConcurrency,
  tags: baseTags,
});

// Shared ECR-access role: App Runner's build-side principal pulls the image.
const ecrAccessRole = new aws.iam.Role("apprunner-ecr-access", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "build.apprunner.amazonaws.com",
  }),
  tags: { ...baseTags, Name: `${namePrefix}-apprunner-ecr-access` },
});
new aws.iam.RolePolicyAttachment("apprunner-ecr-access-policy", {
  role: ecrAccessRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess",
});

// Explicit ARN union the single shared instance role may read: the two DB
// secrets plus every catalog placeholder.  Deliberately NOT a `/<env>/*`
// wildcard — readers share one ARN per secret, enumerated here.
const instanceSecretResources = pulumi
  .all([databaseUrlSecretArn, directUrlSecretArn, catalogSecretArns])
  .apply(([db, direct, catalog]) =>
    appRunnerInstanceSecretArns({
      databaseUrlSecretArn: db as string,
      directUrlSecretArn: direct as string,
      catalogSecretArns: (catalog ?? {}) as Record<string, string>,
    }),
  );

// Shared instance (runtime) role: the running container assumes this to fetch
// its runtimeEnvironmentSecrets and to read/write the uploads bucket.
const instanceRole = new aws.iam.Role("apprunner-instance", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "tasks.apprunner.amazonaws.com",
  }),
  tags: { ...baseTags, Name: `${namePrefix}-apprunner-instance` },
});
new aws.iam.RolePolicy("apprunner-instance-policy", {
  role: instanceRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: instanceSecretResources,
      },
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
        Resource: [uploadsBucketArn, uploadsObjectsArn],
      },
      ...bedrockStatements,
      ...kmsDecryptStatements,
    ],
  }),
});

interface AppRunnerApp {
  name: string;
  port: number;
  healthPath: string; // from infra/shared/apps.manifest.ts
  public: boolean;
}

// Health paths confirmed against infra/shared/apps.manifest.ts.  `workers` is
// intentionally absent — it is deployed as a Lambda below, not App Runner.
const apprunnerApps: AppRunnerApp[] = [
  { name: "dashboard", port: 4000, healthPath: "/api/health", public: true },
  { name: "www", port: 4001, healthPath: "/api/health", public: true },
  { name: "public-api", port: 4002, healthPath: "/health", public: true },
  { name: "public-mcp", port: 4003, healthPath: "/health", public: true },
];

const serviceUrls: Record<string, pulumi.Output<string>> = {};

for (const app of apprunnerApps) {
  // Catalog-driven runtime secrets: App Runner injects each env var from the
  // referenced Secrets Manager ARN at container start.  Readers of the same
  // secret share the identical ARN.
  const runtimeEnvironmentSecrets: Record<string, pulumi.Input<string>> = Object.fromEntries(
    secretsForApp(app.name).map((secret) => [secret.envVar, secretArnOutput(secret.id)]),
  );

  const service = new aws.apprunner.Service(app.name, {
    serviceName: `${namePrefix}-${app.name}`,
    sourceConfiguration: {
      autoDeploymentsEnabled: false,
      authenticationConfiguration: { accessRoleArn: ecrAccessRole.arn },
      imageRepository: {
        imageIdentifier: pulumi.interpolate`${imageRegistry}/${app.name}:${imageTag}`,
        imageRepositoryType: "ECR",
        imageConfiguration: {
          port: String(app.port),
          runtimeEnvironmentVariables: {
            PORT: String(app.port),
            // Next.js standalone defaults to localhost; App Runner health checks
            // need the process listening on all interfaces.
            HOSTNAME: "0.0.0.0",
            WORKER_QUEUE_ADAPTER: "sqs",
            SQS_QUEUE_URL: sqsQueueUrl,
            // The AI SDK's Bedrock provider reads AWS_REGION; App Runner does
            // not set it automatically (Lambda does, as a reserved var).
            AWS_REGION: cfg.ai.bedrockRegion,
            // Secret values now come from Secrets Manager via
            // `runtimeEnvironmentSecrets` below.  What remains here are
            // non-secret bootstrapping URLs — replace with the real public
            // URLs after the first deploy.
            // See infra/aws/GETTING_STARTED.md § Secrets.
            BETTER_AUTH_URL: "http://127.0.0.1:4000",
            NEXT_PUBLIC_BETTER_AUTH_URL: "http://127.0.0.1:4000",
            // public-mcp asserts NEXT_PUBLIC_MCP_URL at process start; PORT is
            // the listen port. Swap for the real public URL after first deploy.
            ...(app.name === "public-mcp"
              ? { NEXT_PUBLIC_MCP_URL: `http://127.0.0.1:${app.port}` }
              : {}),
          },
          runtimeEnvironmentSecrets,
        },
      },
    },
    instanceConfiguration: {
      cpu: "1024",
      memory: "2048",
      instanceRoleArn: instanceRole.arn,
    },
    networkConfiguration: {
      egressConfiguration: {
        egressType: "VPC",
        vpcConnectorArn: vpcConnector.arn,
      },
    },
    healthCheckConfiguration: {
      protocol: "HTTP",
      path: app.healthPath,
      interval: 10,
      timeout: 5,
      healthyThreshold: 1,
      unhealthyThreshold: 5,
    },
    autoScalingConfigurationArn: autoScaling.arn,
    tags: { ...baseTags, Name: `${namePrefix}-${app.name}` },
  });

  serviceUrls[app.name] = service.serviceUrl;

  // WAF association for public services when cloudArmor is enabled.
  //
  // GAP: core does not yet export `wafWebAclArn`, so this output resolves to
  // `undefined` and the block below is inert.  The `.apply` guard ensures an
  // absent/empty ARN is a no-op — we NEVER create an empty-string association.
  // Once core/compliance-resources exports the WebACL ARN this activates
  // automatically with no change here.
  if (app.public && compliance.cloudArmor) {
    wafWebAclArn.apply((arn: unknown) => {
      if (typeof arn === "string" && arn.length > 0) {
        new aws.wafv2.WebAclAssociation(`${app.name}-waf`, {
          resourceArn: service.arn,
          webAclArn: arn,
        });
      }
    });
  }
}

// ===========================================================================
// Workers Lambda + SQS event source mapping
// ===========================================================================

// Explicit ARN list for every secret the workers Lambda reads (catalog-driven).
const workersSecretResources = pulumi.all(
  workersRuntimeSecretIds().map((id) => secretArnOutput(id)),
);

// Lambda execution role: VPC ENI mgmt + logs (managed policies) plus an inline
// policy for SQS consume, secret read, and uploads-bucket access.
const workersRole = new aws.iam.Role("workers-lambda-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "lambda.amazonaws.com",
  }),
  tags: { ...baseTags, Name: `${namePrefix}-workers-lambda` },
});
new aws.iam.RolePolicyAttachment("workers-vpc-access", {
  role: workersRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
});
new aws.iam.RolePolicyAttachment("workers-basic-exec", {
  role: workersRole.name,
  policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
});
new aws.iam.RolePolicy("workers-inline", {
  role: workersRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["sqs:ReceiveMessage", "sqs:DeleteMessage", "sqs:GetQueueAttributes"],
        Resource: sqsQueueArn,
      },
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: workersSecretResources,
      },
      {
        Effect: "Allow",
        Action: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"],
        Resource: [uploadsBucketArn, uploadsObjectsArn],
      },
      ...bedrockStatements,
      ...kmsDecryptStatements,
    ],
  }),
});

// The workers app reads process.env.DATABASE_URL directly.  Rather than change
// app code, resolve the secret's plaintext value at deploy time and inject it
// as a (Pulumi-secret) Lambda env var.  App Runner can pull secrets natively via
// runtimeEnvironmentSecrets, but Lambda has no equivalent, so we resolve here.
const dbSecret = aws.secretsmanager.getSecretVersionOutput({
  secretId: databaseUrlSecretArn,
});

// Same treatment for the workers' remaining catalog secrets: resolve each
// version at deploy time and inject it under the catalog's env var name.
// `pulumi.secret(...)` keeps the plaintext out of stack state output.
const workersSecretEnv: Record<string, pulumi.Output<string>> = Object.fromEntries(
  secretsForApp("workers")
    .filter((secret) => secret.id !== "database-url")
    .map((secret) => [
      secret.envVar,
      pulumi.secret(
        aws.secretsmanager.getSecretVersionOutput({
          secretId: secretArnOutput(secret.id),
        }).secretString,
      ),
    ]),
);

// Container-image packaging: matches the existing Docker pipeline (one image
// per app in ECR) so there is no separate zip build. NOTE this points at the
// dedicated `workers-lambda` image (apps/workers/Dockerfile.lambda), which is
// built on the AWS Lambda Node base image and bundles the Runtime Interface
// Client — NOT the `workers` image, whose CMD runs the long-lived poller
// (`tsx src/index.ts`) and does not implement the Lambda Runtime API.
const workersFn = new aws.lambda.Function("workers", {
  name: `${namePrefix}-workers`,
  packageType: "Image",
  imageUri: pulumi.interpolate`${imageRegistry}/workers-lambda:${imageTag}`,
  imageConfig: {
    commands: ["apps/workers/src/lambda.handler"],
  },
  role: workersRole.arn,
  timeout: 60,
  memorySize: 1024,
  vpcConfig: {
    subnetIds: privateSubnetIds,
    securityGroupIds: [appSecurityGroupId],
  },
  environment: {
    variables: {
      WORKER_QUEUE_ADAPTER: "sqs",
      SQS_QUEUE_URL: sqsQueueUrl,
      DATABASE_URL: pulumi.secret(dbSecret.secretString),
      ...workersSecretEnv,
    },
  },
  tags: { ...baseTags, Name: `${namePrefix}-workers` },
});

// SQS -> Lambda trigger.  ReportBatchItemFailures lets a handler fail
// individual records so only those return to the queue (and eventually the DLQ
// core configured via redrive), rather than the whole batch.
new aws.lambda.EventSourceMapping("workers-sqs", {
  eventSourceArn: sqsQueueArn,
  functionName: workersFn.arn,
  batchSize: 10,
  functionResponseTypes: ["ReportBatchItemFailures"],
});

// ===========================================================================
// EventBridge Scheduler: repeatable jobs
// ===========================================================================

// Scheduler role: allowed only to SendMessage to the jobs queue.  Routing the
// scheduled job through SQS (rather than invoking the Lambda directly) preserves
// the DLQ/redrive path core set up.
const schedulerRole = new aws.iam.Role("scheduler-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "scheduler.amazonaws.com",
  }),
  tags: { ...baseTags, Name: `${namePrefix}-scheduler` },
});
new aws.iam.RolePolicy("scheduler-sqs", {
  role: schedulerRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [{ Effect: "Allow", Action: ["sqs:SendMessage"], Resource: sqsQueueArn }],
  }),
});

// cleanup.expired-sessions — cron "0 3 * * *" (daily 03:00), mirroring the
// repeatable job registered in apps/workers/src/scheduled.ts.  Input is the job
// envelope the workers handler expects.
new aws.scheduler.Schedule("cleanup-expired-sessions", {
  name: `${namePrefix}-cleanup-expired-sessions`,
  scheduleExpression: "cron(0 3 * * ? *)",
  flexibleTimeWindow: { mode: "OFF" },
  target: {
    arn: sqsQueueArn,
    roleArn: schedulerRole.arn,
    input: JSON.stringify({ event: "cleanup.expired-sessions", payload: {} }),
  },
});

// --- Exports ----------------------------------------------------------------
export { imageRegistry };
export const dashboardUrl = serviceUrls["dashboard"];
export const wwwUrl = serviceUrls["www"];
export const publicApiUrl = serviceUrls["public-api"];
export const publicMcpUrl = serviceUrls["public-mcp"];
export const workersFunctionArn = workersFn.arn;
export const workersFunctionName = workersFn.name;
