import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

import { config as sandboxConfig } from "../config.sandbox";
import { config as stagingConfig } from "../config.staging";
import { config as productionConfig } from "../config.production";
import { resolveCompliance } from "../../shared/compliance";

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

// Deploy-time values still come from pulumi.Config (not baked into the env
// config): the core stack reference and the ECR registry URL.
const config = new pulumi.Config();
const coreStackRef = config.require("coreStackRef");
const imageRegistry = config.require("imageRegistry"); // ECR registry URL

const imageTag = cfg.apps.imageTag;

// The AWS provider reads `aws:region` from stack config; fall back to the env
// config's region so both stay in sync (kept identical to core).
const region = new pulumi.Config("aws").get("region") ?? cfg.aws.region;

const namePrefix = `starter-${stack}`;
const baseTags = { Project: "starter", Stack: stack, ManagedBy: "pulumi" };

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
const autoScaling = new aws.apprunner.AutoScalingConfigurationVersion(
  "apps-autoscaling",
  {
    autoScalingConfigurationName: `${namePrefix}-asc`,
    minSize: cfg.apps.minSize,
    maxSize: cfg.apps.maxSize,
    maxConcurrency: cfg.apps.maxConcurrency,
    tags: baseTags,
  },
);

// Shared ECR-access role: App Runner's build-side principal pulls the image.
const ecrAccessRole = new aws.iam.Role("apprunner-ecr-access", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "build.apprunner.amazonaws.com",
  }),
  tags: { ...baseTags, Name: `${namePrefix}-apprunner-ecr-access` },
});
new aws.iam.RolePolicyAttachment("apprunner-ecr-access-policy", {
  role: ecrAccessRole.name,
  policyArn:
    "arn:aws:iam::aws:policy/service-role/AWSAppRunnerServicePolicyForECRAccess",
});

// Shared instance (runtime) role: the running container assumes this to fetch
// runtimeEnvironmentSecrets (DATABASE_URL) and to read/write the uploads bucket.
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
        Resource: [databaseUrlSecretArn, directUrlSecretArn],
      },
      {
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ],
        Resource: [uploadsBucketArn, uploadsObjectsArn],
      },
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
            WORKER_QUEUE_ADAPTER: "sqs",
            SQS_QUEUE_URL: sqsQueueUrl,
          },
          runtimeEnvironmentSecrets: {
            DATABASE_URL: databaseUrlSecretArn,
          },
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
  policyArn:
    "arn:aws:iam::aws:policy/service-role/AWSLambdaVPCAccessExecutionRole",
});
new aws.iam.RolePolicyAttachment("workers-basic-exec", {
  role: workersRole.name,
  policyArn:
    "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
});
new aws.iam.RolePolicy("workers-inline", {
  role: workersRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: [
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:GetQueueAttributes",
        ],
        Resource: sqsQueueArn,
      },
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: databaseUrlSecretArn,
      },
      {
        Effect: "Allow",
        Action: [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:ListBucket",
        ],
        Resource: [uploadsBucketArn, uploadsObjectsArn],
      },
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

// Container-image packaging (preferred): matches the existing Docker pipeline
// (one image per app in ECR) so there is no separate zip build.  The Lambda
// entrypoint built in Task 2 is invoked via imageConfig.command.
const workersFn = new aws.lambda.Function("workers", {
  name: `${namePrefix}-workers`,
  packageType: "Image",
  imageUri: pulumi.interpolate`${imageRegistry}/workers:${imageTag}`,
  imageConfig: {
    commands: ["lambda.handler"],
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
    Statement: [
      { Effect: "Allow", Action: ["sqs:SendMessage"], Resource: sqsQueueArn },
    ],
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
export const dashboardUrl = serviceUrls["dashboard"];
export const wwwUrl = serviceUrls["www"];
export const publicApiUrl = serviceUrls["public-api"];
export const publicMcpUrl = serviceUrls["public-mcp"];
export const workersFunctionArn = workersFn.arn;
export const workersFunctionName = workersFn.name;
