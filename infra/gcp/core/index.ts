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
const dbAvailability = config.get("dbAvailability") ?? "ZONAL";
const dbPointInTime = config.getBoolean("dbPointInTime") ?? false;
const privateNetwork = config.getBoolean("privateNetwork") ?? false;
const vpcCidr = config.get("vpcCidr") ?? "10.10.0.0/24";

// --- VPC + Serverless VPC connector (production / privateNetwork only) -------

const network = privateNetwork
  ? new gcp.compute.Network("starter-vpc", { autoCreateSubnetworks: false })
  : undefined;

const subnet = network
  ? new gcp.compute.Subnetwork("starter-subnet", {
      network: network.id,
      region,
      ipCidrRange: vpcCidr,
      privateIpGoogleAccess: true,
    })
  : undefined;

const vpcConnector = network
  ? new gcp.vpcaccess.Connector("starter-connector", {
      region,
      network: network.name,
      ipCidrRange: "10.20.0.0/28", // /28 required for connector
      minThroughput: 200,
      maxThroughput: 300,
    })
  : undefined;

// Private services access range — required for Cloud SQL private IP.
const psaRange = network
  ? new gcp.compute.GlobalAddress("starter-psa", {
      purpose: "VPC_PEERING",
      addressType: "INTERNAL",
      prefixLength: 16,
      network: network.id,
    })
  : undefined;

const psa =
  network && psaRange
    ? new gcp.servicenetworking.Connection("starter-psa-conn", {
        network: network.id,
        service: "servicenetworking.googleapis.com",
        reservedPeeringRanges: [psaRange.name],
      })
    : undefined;

// --- Cloud SQL Postgres -------------------------------------------------------
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
      availabilityType: dbAvailability,
      backupConfiguration: {
        enabled: true,
        pointInTimeRecoveryEnabled: dbPointInTime,
      },
      // Production: private IP only (no public IPv4), routed through the VPC.
      // Sandbox: public IP (default); Cloud Run uses SQL Proxy socket via the
      // attached `cloudsql` volume + connectionName.
      ipConfiguration: network
        ? {
            ipv4Enabled: false,
            privateNetwork: network.id,
          }
        : { ipv4Enabled: true },
    },
  },
  {
    protect: true,
    deleteBeforeReplace: false,
    dependsOn: psa ? [psa] : [],
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

// Compose the DATABASE_URL connection string.
// Sandbox: Cloud Run reaches the instance through the SQL Proxy unix socket
//   mounted at `/cloudsql/<connectionName>`.
// Production: direct TCP via private IP through the VPC connector.
const databaseUrlInternal = network
  ? pulumi.interpolate`postgresql://${dbUser.name}:${dbPassword.result}@${dbInstance.privateIpAddress}/${dbName.name}`
  : pulumi.interpolate`postgresql://${dbUser.name}:${dbPassword.result}@/${dbName.name}?host=/cloudsql/${dbInstance.connectionName}`;

// --- Secret Manager: stash the DATABASE_URL ----------------------------------
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

// --- Pub/Sub -----------------------------------------------------------------
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

// --- Exports (consumed by apps stack) ----------------------------------------
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
// Network outputs — empty string when sandbox (private networking disabled).
export const vpcConnectorId = vpcConnector ? vpcConnector.id : pulumi.output("");
export const networkSelfLink = network ? network.selfLink : pulumi.output("");
export const subnetSelfLink = subnet ? subnet.selfLink : pulumi.output("");
export const privateNetworkEnabled = pulumi.output(privateNetwork ? "true" : "false");
