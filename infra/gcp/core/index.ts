import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const region = gcpConfig.require("region");
const project = gcpConfig.require("project");

// Per-stack tuning (sandbox uses smallest tier).
const dbTier = config.get("dbTier") ?? "db-f1-micro";
const dbVersion = config.get("dbVersion") ?? "POSTGRES_16";

// --- Cloud SQL Postgres -----------------------------------------------------
// Random password — alternative: `pulumi config set --secret dbPassword <value>`
// and `config.requireSecret("dbPassword")`. We default to RandomPassword so the
// sandbox spins up without manual config.
const dbPassword = new random.RandomPassword("db-password", {
  length: 32,
  special: false,
});

const dbInstance = new gcp.sql.DatabaseInstance(
  "starter-db",
  {
    name: pulumi.interpolate`starter-db-${pulumi.getStack()}`,
    databaseVersion: dbVersion,
    region,
    deletionProtection: true,
    settings: {
      tier: dbTier,
      availabilityType: "ZONAL", // REGIONAL for prod (Task 7.1)
      backupConfiguration: {
        enabled: true,
        pointInTimeRecoveryEnabled: false,
      },
      // No private IP for sandbox; Cloud Run uses the SQL Proxy socket via the
      // attached `cloudsql` volume + connectionName. Public IP stays enabled
      // (default) but authorized networks remain empty.
    },
  },
  {
    protect: true,
    deleteBeforeReplace: false,
  },
);

const dbName = new gcp.sql.Database("app-db", {
  instance: dbInstance.name,
  name: "starter",
});

const dbUser = new gcp.sql.User("app-user", {
  instance: dbInstance.name,
  name: "starter",
  password: dbPassword.result,
});

// Compose the DATABASE_URL connection string. Cloud Run reaches the instance
// through the SQL Proxy unix socket mounted at `/cloudsql/<connectionName>`.
// In production (Task 7.1) we switch to private IP + VPC connector.
const databaseUrlInternal = pulumi.interpolate`postgresql://${dbUser.name}:${dbPassword.result}@/${dbName.name}?host=/cloudsql/${dbInstance.connectionName}`;

// --- Secret Manager: stash the DATABASE_URL ---------------------------------
const dbUrlSecret = new gcp.secretmanager.Secret("database-url", {
  secretId: "database-url",
  replication: { auto: {} },
});

const dbUrlSecretVersion = new gcp.secretmanager.SecretVersion(
  "database-url-v1",
  {
    secret: dbUrlSecret.id,
    secretData: databaseUrlInternal,
  },
);

// --- Pub/Sub ----------------------------------------------------------------
const jobsTopic = new gcp.pubsub.Topic("jobs", {
  name: pulumi.interpolate`jobs-${pulumi.getStack()}`,
});

const dlqTopic = new gcp.pubsub.Topic("jobs-dlq", {
  name: pulumi.interpolate`jobs-dlq-${pulumi.getStack()}`,
});

const jobsSubscription = new gcp.pubsub.Subscription("jobs-sub", {
  name: pulumi.interpolate`jobs-sub-${pulumi.getStack()}`,
  topic: jobsTopic.name,
  ackDeadlineSeconds: 60,
  retryPolicy: {
    minimumBackoff: "5s",
    maximumBackoff: "600s",
  },
  deadLetterPolicy: {
    deadLetterTopic: dlqTopic.id,
    maxDeliveryAttempts: 5,
  },
});

// --- Exports (consumed by apps stack) ---------------------------------------
export const projectId = project;
export const regionOutput = region;
export const databaseUrl = pulumi.secret(databaseUrlInternal);
export const databaseUrlSecretName = dbUrlSecret.name; // for IAM grants
export const databaseUrlSecretId = dbUrlSecret.secretId;
export const pubsubTopicName = jobsTopic.name;
export const pubsubSubscriptionName = jobsSubscription.name;
export const pubsubDlqTopicName = dlqTopic.name;
export const sqlConnectionName = dbInstance.connectionName;
export const sqlInstanceName = dbInstance.name;
// Re-export to silence "declared but never used" — version pins the secret.
export const databaseUrlSecretVersion = dbUrlSecretVersion.name;
