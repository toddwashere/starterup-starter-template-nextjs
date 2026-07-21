import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from "@pulumi/random";

import { config as sandboxConfig } from "../config.sandbox";
import { config as stagingConfig } from "../config.staging";
import { config as productionConfig } from "../config.production";
import { resolveCompliance } from "../../shared/compliance";
import {
  deploymentNames,
  resolveDeploymentIdentity,
  type AwsEnvironment,
} from "../naming";
import { buildComplianceResources } from "./compliance-resources";
import { buildVercelAccess } from "./vercel-access";
import { buildPoolerStack } from "./pooler-stack";
import { buildQueues } from "./queues";
import { buildManualSecrets } from "./manual-secrets";
import { poolerConfigFromEnv } from "../env";

// --- Config loading ---------------------------------------------------------
// Robust static-import + stack-name selection.  A dynamic template import
// (`await import(\`../config.${env}\`)`) is fragile under the Pulumi TS runtime's
// module resolution, so we import all three statically and pick by stack name.
const CONFIGS = {
  sandbox: sandboxConfig,
  staging: stagingConfig,
  production: productionConfig,
} as const;

const stack = pulumi.getStack();
const env = stack as keyof typeof CONFIGS;
const cfg = CONFIGS[env] ?? sandboxConfig;

// The AWS provider reads `aws:region` from stack config; fall back to the
// env config's region so both stay in sync.
const region = new pulumi.Config("aws").get("region") ?? cfg.aws.region;

const identity = resolveDeploymentIdentity(process.env);
const names = deploymentNames(identity, stack as AwsEnvironment);
const namePrefix = names.globalPrefix;
const baseTags = { ...names.tags, Layer: "core" };

// Production must never lose persisted data: keep RDS deletion protection, a
// final snapshot, Pulumi resource protection, and Secrets Manager recovery
// windows. Non-production stacks are disposable so `pulumi destroy` tears down
// cleanly and leaves no orphaned RDS instances, snapshots, secrets, or buckets.
const isProduction = env === "production";

// --- Compliance -------------------------------------------------------------
// resolveCompliance derives the per-feature flags (cmek, auditLogs, …) from the
// coarse complianceMode; buildComplianceResources materialises the always-safe
// bundle (KMS key, immutable log sink, CloudTrail, WAF, Config rules) gated on
// those flags.  kmsKeyArn is "" when CMEK is disabled.
const compliance = resolveCompliance(cfg.complianceMode);
const { kmsKeyArn } = buildComplianceResources({
  namePrefix,
  region,
  compliance,
});

// When CMEK is on, feed the KMS key to RDS/S3; otherwise use the service
// default (AWS-managed key for RDS, SSE-S3 for the bucket).
const cmekKeyId: pulumi.Output<string> | undefined = compliance.cmek ? kmsKeyArn : undefined;

// --- Networking: VPC + subnets + IGW + NAT ----------------------------------
const azs = aws.getAvailabilityZonesOutput({ state: "available" });
const azCount = 2;

// Derive /24 subnet CIDRs from the (assumed /16) VPC CIDR by fixing the third
// octet.  All env configs use a /16 base (e.g. 10.30.0.0/16).
const cidrPrefix = cfg.network.vpcCidr.split(".").slice(0, 2).join(".");
const publicCidr = (i: number) => `${cidrPrefix}.${i}.0/24`;
const privateCidr = (i: number) => `${cidrPrefix}.${10 + i}.0/24`;

const vpc = new aws.ec2.Vpc("vpc", {
  cidrBlock: cfg.network.vpcCidr,
  enableDnsHostnames: true,
  enableDnsSupport: true,
  tags: { ...baseTags, Name: `${namePrefix}-vpc` },
});

const igw = new aws.ec2.InternetGateway("igw", {
  vpcId: vpc.id,
  tags: { ...baseTags, Name: `${namePrefix}-igw` },
});

// Public route table (shared): default route to the IGW.
const publicRouteTable = new aws.ec2.RouteTable("public-rt", {
  vpcId: vpc.id,
  tags: { ...baseTags, Name: `${namePrefix}-public-rt` },
});
new aws.ec2.Route("public-default-route", {
  routeTableId: publicRouteTable.id,
  destinationCidrBlock: "0.0.0.0/0",
  gatewayId: igw.id,
});

const publicSubnets: aws.ec2.Subnet[] = [];
const privateSubnets: aws.ec2.Subnet[] = [];
const natGateways: aws.ec2.NatGateway[] = [];

for (let i = 0; i < azCount; i++) {
  const az = azs.names.apply((names) => names[i]);

  const publicSubnet = new aws.ec2.Subnet(`public-subnet-${i}`, {
    vpcId: vpc.id,
    cidrBlock: publicCidr(i),
    availabilityZone: az,
    mapPublicIpOnLaunch: true,
    tags: { ...baseTags, Name: `${namePrefix}-public-${i}`, Tier: "public" },
  });
  publicSubnets.push(publicSubnet);

  new aws.ec2.RouteTableAssociation(`public-rta-${i}`, {
    subnetId: publicSubnet.id,
    routeTableId: publicRouteTable.id,
  });

  const privateSubnet = new aws.ec2.Subnet(`private-subnet-${i}`, {
    vpcId: vpc.id,
    cidrBlock: privateCidr(i),
    availabilityZone: az,
    mapPublicIpOnLaunch: false,
    tags: { ...baseTags, Name: `${namePrefix}-private-${i}`, Tier: "private" },
  });
  privateSubnets.push(privateSubnet);
}

// NAT gateways: one per AZ when multiAzNat, otherwise a single shared NAT in
// the first public subnet.
const natCount = cfg.network.multiAzNat ? azCount : 1;
for (let i = 0; i < natCount; i++) {
  const eip = new aws.ec2.Eip(`nat-eip-${i}`, {
    domain: "vpc",
    tags: { ...baseTags, Name: `${namePrefix}-nat-eip-${i}` },
  });
  const nat = new aws.ec2.NatGateway(`nat-${i}`, {
    allocationId: eip.id,
    subnetId: publicSubnets[i].id,
    tags: { ...baseTags, Name: `${namePrefix}-nat-${i}` },
  });
  natGateways.push(nat);
}

// Private route tables: each private subnet routes 0.0.0.0/0 to a NAT.  With a
// single NAT every subnet shares it; with multiAzNat each uses its own AZ's NAT.
for (let i = 0; i < azCount; i++) {
  const nat = cfg.network.multiAzNat ? natGateways[i] : natGateways[0];
  const privateRouteTable = new aws.ec2.RouteTable(`private-rt-${i}`, {
    vpcId: vpc.id,
    tags: { ...baseTags, Name: `${namePrefix}-private-rt-${i}` },
  });
  new aws.ec2.Route(`private-default-route-${i}`, {
    routeTableId: privateRouteTable.id,
    destinationCidrBlock: "0.0.0.0/0",
    natGatewayId: nat.id,
  });
  new aws.ec2.RouteTableAssociation(`private-rta-${i}`, {
    subnetId: privateSubnets[i].id,
    routeTableId: privateRouteTable.id,
  });
}

const privateSubnetIds = pulumi.all(privateSubnets.map((s) => s.id));

// --- Security groups --------------------------------------------------------
// app-sg: workloads (Fargate/App Runner connectors) — egress anywhere.
const appSg = new aws.ec2.SecurityGroup("app-sg", {
  vpcId: vpc.id,
  description: "Starter application workloads security group",
  egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
  tags: { ...baseTags, Name: `${namePrefix}-app-sg` },
});

// db-sg: Postgres (5432) reachable only from app-sg.  The RDS Proxy also lives
// in db-sg, and its self-ingress lets the proxy reach the instance.
const dbSg = new aws.ec2.SecurityGroup("db-sg", {
  vpcId: vpc.id,
  description: "Starter database security group",
  egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
  tags: { ...baseTags, Name: `${namePrefix}-db-sg` },
});

// Ingress 5432 from app-sg (app -> proxy/db).
new aws.ec2.SecurityGroupRule("db-sg-ingress-from-app", {
  type: "ingress",
  securityGroupId: dbSg.id,
  fromPort: 5432,
  toPort: 5432,
  protocol: "tcp",
  sourceSecurityGroupId: appSg.id,
  description: "Postgres from app-sg",
});

// Self-ingress 5432 (proxy -> instance, both in db-sg).
new aws.ec2.SecurityGroupRule("db-sg-ingress-self", {
  type: "ingress",
  securityGroupId: dbSg.id,
  fromPort: 5432,
  toPort: 5432,
  protocol: "tcp",
  self: true,
  description: "Postgres within db-sg (RDS Proxy to instance)",
});

// --- RDS Postgres (private) -------------------------------------------------
const dbPassword = new random.RandomPassword("db-password", {
  length: 32,
  special: false,
});

const dbSubnetGroup = new aws.rds.SubnetGroup("db-subnets", {
  name: `${namePrefix}-db-subnets`,
  subnetIds: privateSubnetIds,
  tags: { ...baseTags, Name: `${namePrefix}-db-subnets` },
});

const db = new aws.rds.Instance(
  "starter-db",
  {
    identifier: `${namePrefix}-db`,
    engine: "postgres",
    engineVersion: cfg.database.engineVersion,
    instanceClass: cfg.database.instanceClass,
    allocatedStorage: cfg.database.allocatedStorage,
    username: "starter",
    password: dbPassword.result,
    dbName: "starter",
    dbSubnetGroupName: dbSubnetGroup.name,
    vpcSecurityGroupIds: [dbSg.id],
    multiAz: cfg.database.multiAz,
    publiclyAccessible: false,
    storageEncrypted: true,
    kmsKeyId: cmekKeyId,
    // Non-prod: skip the final snapshot so destroy completes without leaving a
    // lingering snapshot artifact. Prod: always take a final snapshot.
    skipFinalSnapshot: !isProduction,
    finalSnapshotIdentifier: isProduction ? `${namePrefix}-db-final` : undefined,
    deletionProtection: isProduction,
    backupRetentionPeriod: 7,
    tags: { ...baseTags, Name: `${namePrefix}-db` },
  },
  {
    // Only guard production against accidental deletion; non-prod is disposable.
    protect: isProduction,
    deleteBeforeReplace: false,
  },
);

// --- RDS Proxy (pooled endpoint) --------------------------------------------
// Auth secret in the {username,password} shape RDS Proxy expects.
const proxyAuthSecret = new aws.secretsmanager.Secret("rds-proxy-auth", {
  name: `${names.secretPathPrefix}/rds-proxy-auth`,
  // Non-prod: 0 = force delete without a recovery window so the same secret
  // name can be re-created immediately on the next deploy. Prod: 7-day recovery.
  recoveryWindowInDays: isProduction ? 7 : 0,
  kmsKeyId: cmekKeyId,
});
new aws.secretsmanager.SecretVersion("rds-proxy-auth-v1", {
  secretId: proxyAuthSecret.id,
  secretString: pulumi.jsonStringify({
    username: "starter",
    password: dbPassword.result,
  }),
});

// IAM role the proxy assumes to read the auth secret (and decrypt via CMEK).
const proxyRole = new aws.iam.Role("rds-proxy-role", {
  assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
    Service: "rds.amazonaws.com",
  }),
  tags: { ...baseTags, Name: `${namePrefix}-rds-proxy-role` },
});
new aws.iam.RolePolicy("rds-proxy-secrets-policy", {
  role: proxyRole.id,
  policy: pulumi.jsonStringify({
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: ["secretsmanager:GetSecretValue"],
        Resource: proxyAuthSecret.arn,
      },
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
    ],
  }),
});

const dbProxy = new aws.rds.Proxy("db-proxy", {
  name: `${namePrefix}-db-proxy`,
  engineFamily: "POSTGRESQL",
  roleArn: proxyRole.arn,
  vpcSubnetIds: privateSubnetIds,
  vpcSecurityGroupIds: [dbSg.id],
  requireTls: true,
  idleClientTimeout: 1800,
  auths: [
    {
      authScheme: "SECRETS",
      iamAuth: "DISABLED",
      secretArn: proxyAuthSecret.arn,
    },
  ],
  tags: { ...baseTags, Name: `${namePrefix}-db-proxy` },
});

const dbProxyTargetGroup = new aws.rds.ProxyDefaultTargetGroup("db-proxy-tg", {
  dbProxyName: dbProxy.name,
  connectionPoolConfig: {
    maxConnectionsPercent: 100,
    maxIdleConnectionsPercent: 50,
    connectionBorrowTimeout: 120,
  },
});

new aws.rds.ProxyTarget("db-proxy-target", {
  dbProxyName: dbProxy.name,
  targetGroupName: dbProxyTargetGroup.name,
  dbInstanceIdentifier: db.identifier,
});

// --- SQS (registry: each queue gets an automatic DLQ) -----------------------
// Add queues in `core/queues.ts`; every entry gets a matching DLQ + redrive.
// `jobs` is load-bearing (consumed by the workers Lambda / scheduler in apps).
const queues = buildQueues({ tags: baseTags, queueName: names.queueName });
const jobsQueue = queues.jobs.queue;
const dlq = queues.jobs.dlq;

// --- S3 uploads bucket ------------------------------------------------------
const uploadsBucketResource = new aws.s3.BucketV2("uploads", {
  bucketPrefix: `${namePrefix}-uploads-`,
  // Non-prod: allow destroy to delete a non-empty bucket. Prod: retain objects.
  forceDestroy: !isProduction,
  tags: { ...baseTags, Name: `${namePrefix}-uploads` },
});

new aws.s3.BucketServerSideEncryptionConfigurationV2("uploads-sse", {
  bucket: uploadsBucketResource.id,
  rules: [
    compliance.cmek
      ? {
          applyServerSideEncryptionByDefault: {
            sseAlgorithm: "aws:kms",
            kmsMasterKeyId: kmsKeyArn,
          },
          bucketKeyEnabled: true,
        }
      : {
          applyServerSideEncryptionByDefault: { sseAlgorithm: "AES256" },
        },
  ],
});

new aws.s3.BucketPublicAccessBlock("uploads-public-access-block", {
  bucket: uploadsBucketResource.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

// --- Secrets Manager: connection strings ------------------------------------
// POOLED: routes through the RDS Proxy endpoint (App workloads use this).
// `sslmode=require` is mandatory: the proxy sets requireTls:true, and the
// runtime @prisma/adapter-pg (pg) defaults to no TLS otherwise → connection
// rejected.
const pooledUrl = pulumi.interpolate`postgresql://starter:${dbPassword.result}@${dbProxy.endpoint}:5432/starter?sslmode=require`;
// DIRECT: hits the instance endpoint directly (migrations / long transactions).
// PG16's default parameter group ships rds.force_ssl=1, so require TLS here too.
const directUrl = pulumi.interpolate`postgresql://starter:${dbPassword.result}@${db.endpoint}/starter?sslmode=require`;

const dbUrlSecret = new aws.secretsmanager.Secret("database-url", {
  name: `${names.secretPathPrefix}/database-url`,
  recoveryWindowInDays: isProduction ? 7 : 0,
  kmsKeyId: cmekKeyId,
});
new aws.secretsmanager.SecretVersion("database-url-v1", {
  secretId: dbUrlSecret.id,
  secretString: pooledUrl,
});

const directUrlSecret = new aws.secretsmanager.Secret("direct-url", {
  name: `${names.secretPathPrefix}/direct-url`,
  recoveryWindowInDays: isProduction ? 7 : 0,
  kmsKeyId: cmekKeyId,
});
new aws.secretsmanager.SecretVersion("direct-url-v1", {
  secretId: directUrlSecret.id,
  secretString: directUrl,
});

// --- Manually-managed secrets (empty placeholders) --------------------------
// Third-party API keys etc. that Pulumi can't derive. Each entry in
// `core/manual-secrets.ts` becomes an empty `/<env>/<name>` secret you
// populate once in the console/CLI; Pulumi never stores or overwrites the value.
const manualSecrets = buildManualSecrets({
  secretPathPrefix: names.secretPathPrefix,
  isProduction,
  cmekKeyId,
  tags: baseTags,
});

// --- Public PgBouncer pooler (Vercel -> pooled Postgres) --------------------
// RDS Proxy can't be public, so Vercel's pooled path terminates at a PgBouncer
// NLB (public) backed by Fargate tasks in private subnets. RDS stays private.
// The pooler uses a custom Route 53 hostname with verified TLS.

let poolerHostname: string | undefined;
let poolerCertificateArn: pulumi.Output<string> | undefined;
let poolerTlsAlarmName: pulumi.Output<string> | undefined;
let poolerEndpointOutput: string | undefined;
let vercelDbUrlSecretArn: pulumi.Output<string> | undefined;

if (cfg.database.pooler.enabled) {
  const poolerConfig = poolerConfigFromEnv(env);
  let hostedZone: Awaited<ReturnType<typeof aws.route53.getZone>>;
  let alertTopic: Awaited<ReturnType<typeof aws.sns.getTopic>>;
  try {
    [hostedZone, alertTopic] = await Promise.all([
      aws.route53.getZone({
        name: `${poolerConfig.zoneName}.`,
        privateZone: false,
      }),
      aws.sns.getTopic({ name: `${namePrefix}-infra-alerts` }),
    ]);
  } catch (error) {
    throw new Error(
      `Missing ${poolerConfig.zoneName} bootstrap resources. Deploy bootstrap, ` +
        `delegate its nameservers, and retry core. Cause: ${String(error)}`,
    );
  }

  const accountId = aws.getCallerIdentityOutput().accountId;

  const poolerStack = buildPoolerStack({
    namePrefix,
    secretPathPrefix: names.secretPathPrefix,
    logGroupPrefix: names.logGroupPrefix,
    region,
    accountId,
    poolerConfig,
    hostedZone,
    alertTopic,
    vpcId: vpc.id,
    publicSubnetIds: publicSubnets.map((s) => s.id),
    privateSubnetIds,
    dbSecurityGroupId: dbSg.id,
    dbHost: db.address,
    dbName: "starter",
    dbUsername: "starter",
    dbPassword: dbPassword.result,
    dbSecretArn: proxyAuthSecret.arn,
    pooler: cfg.database.pooler,
    cmekKeyArn: cmekKeyId,
    isProduction,
    tags: baseTags,
  });

  poolerHostname = poolerStack.poolerHostname;
  poolerCertificateArn = poolerStack.poolerCertificateArn;
  poolerTlsAlarmName = poolerStack.poolerTlsAlarmName;
  poolerEndpointOutput = poolerStack.poolerEndpointOutput;
  vercelDbUrlSecretArn = poolerStack.vercelDatabaseUrlSecretArn;
}

// --- Vercel OIDC access (hybrid: Vercel apps -> AWS data/AI plane) -----------
// Keyless, least-privilege role Vercel assumes via OIDC. Only created when a
// team slug is configured (the hybrid profile); pure-AWS deploys leave it unset.
let vercelAccessRoleArn: pulumi.Output<string> | undefined;
if (cfg.access.vercelOidc.teamSlug.trim()) {
  const vercelAccess = buildVercelAccess({
    namePrefix,
    vercelOidc: cfg.access.vercelOidc,
    uploadsBucketArn: uploadsBucketResource.arn,
    jobsQueueArn: jobsQueue.arn,
    // Vercel reads the pooled (PgBouncer) URL; the direct URL is for migrations.
    secretArns: [
      ...(vercelDbUrlSecretArn ? [vercelDbUrlSecretArn] : [dbUrlSecret.arn]),
      directUrlSecret.arn,
    ],
    bedrockRegion: cfg.ai.bedrockRegion,
    bedrockModels: cfg.ai.bedrockModels,
    cmekKeyArn: cmekKeyId,
    tags: baseTags,
  });
  vercelAccessRoleArn = vercelAccess.roleArn;
}

// --- Exports ----------------------------------------------------------------
// Required by Task 7 (apps layer) via StackReference — names are load-bearing.
export const vpcId = vpc.id;
export const appSecurityGroupId = appSg.id;
export const dbProxyEndpoint = dbProxy.endpoint;
export const databaseUrlSecretArn = dbUrlSecret.arn;
export const directUrlSecretArn = directUrlSecret.arn;
export const sqsQueueUrl = jobsQueue.url;
export const sqsQueueArn = jobsQueue.arn;
export const sqsDlqArn = dlq.arn;
// Every queue in the registry, keyed by QueueSpec.key — wire new consumers in
// the apps stack off these maps.
export const queueUrls = Object.fromEntries(
  Object.entries(queues).map(([key, q]) => [key, q.queue.url]),
);
export const queueArns = Object.fromEntries(
  Object.entries(queues).map(([key, q]) => [key, q.queue.arn]),
);
export const uploadsBucket = uploadsBucketResource.bucket;
// Names + ARNs of the manually-managed placeholder secrets (empty until you set
// their values in the console/CLI). Grant read access from consumers as needed.
export const manualSecretArns = Object.fromEntries(manualSecrets.map((s) => [s.name, s.arn]));
// Re-export the compliance KMS key ARN ("" when CMEK is disabled).
export { kmsKeyArn, privateSubnetIds };

// Preserved from the prior core stack (still consumed / informational).
export const regionOutput = region;
export const sqsDlqUrl = dlq.url;
export const dbInstanceEndpoint = db.endpoint;
// ARN of the Vercel OIDC access role (undefined for pure-AWS deploys). Paste
// into the Vercel project as AWS_ROLE_ARN.
export const vercelAccessRoleArnOutput = vercelAccessRoleArn;
// Public PgBouncer pooler outputs (custom hostname, not generated NLB name).
export { poolerHostname, poolerCertificateArn, poolerTlsAlarmName, poolerEndpointOutput };
// Vercel-facing pooled DATABASE_URL secret ARN.
export const vercelDatabaseUrlSecretArn = vercelDbUrlSecretArn;
