import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const awsConfig = new pulumi.Config("aws");
const region = awsConfig.require("region");

const dbInstanceClass = config.get("dbInstanceClass") ?? "db.t4g.micro";
const dbEngineVersion = config.get("dbEngineVersion") ?? "16";
const dbAllocatedStorage = config.getNumber("dbAllocatedStorage") ?? 20;

// --- RDS Postgres -----------------------------------------------------------
const dbPassword = new random.RandomPassword("db-password", {
  length: 32,
  special: false,
});

const db = new aws.rds.Instance(
  "starter-db",
  {
    identifier: pulumi.interpolate`starter-db-${pulumi.getStack()}`,
    engine: "postgres",
    engineVersion: dbEngineVersion,
    instanceClass: dbInstanceClass,
    allocatedStorage: dbAllocatedStorage,
    username: "starter",
    password: dbPassword.result,
    dbName: "starter",
    skipFinalSnapshot: false,
    deletionProtection: true,
    publiclyAccessible: false,
    backupRetentionPeriod: 7,
  },
  {
    protect: true,
    deleteBeforeReplace: false,
  },
);

// --- SQS (jobs queue + DLQ) -------------------------------------------------
const dlq = new aws.sqs.Queue("jobs-dlq", {
  name: pulumi.interpolate`starter-jobs-dlq-${pulumi.getStack()}`,
  messageRetentionSeconds: 1209600, // 14 days
});

const jobsQueue = new aws.sqs.Queue("jobs", {
  name: pulumi.interpolate`starter-jobs-${pulumi.getStack()}`,
  visibilityTimeoutSeconds: 60,
  messageRetentionSeconds: 345600, // 4 days
  redrivePolicy: pulumi.jsonStringify({
    deadLetterTargetArn: dlq.arn,
    maxReceiveCount: 5,
  }),
});

// --- Secrets Manager: DATABASE_URL -----------------------------------------
const databaseUrlInternal = pulumi.interpolate`postgresql://starter:${dbPassword.result}@${db.endpoint}/starter`;

const dbUrlSecret = new aws.secretsmanager.Secret("database-url", {
  name: pulumi.interpolate`/starter/${pulumi.getStack()}/database-url`,
  recoveryWindowInDays: 7,
});

const _dbUrlSecretVersion = new aws.secretsmanager.SecretVersion("database-url-v1", {
  secretId: dbUrlSecret.id,
  secretString: databaseUrlInternal,
});

// --- Exports ----------------------------------------------------------------
export const regionOutput = region;
export const databaseUrl = pulumi.secret(databaseUrlInternal);
export const databaseUrlSecretArn = dbUrlSecret.arn;
export const sqsQueueUrl = jobsQueue.url;
export const sqsQueueArn = jobsQueue.arn;
export const sqsDlqArn = dlq.arn;
export const sqsDlqUrl = dlq.url;
