import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const region = gcpConfig.require("region");

// --- Read foundational outputs from the bootstrap layer. ---------------------
const bootstrap = new pulumi.StackReference(config.require("bootstrapStackRef"));
// "" when networking is disabled (sandbox). Non-empty => private IP via the VPC.
const networkId = bootstrap.getOutput("networkId");
// Created in bootstrap; documents the ordering dependency for private IP.
const privateServicesConnection = bootstrap.getOutput("privateServicesConnection");

// --- Per-stack tuning (sandbox uses smallest tier, public IP, no PITR). ------
const dbTier = config.get("dbTier") ?? "db-f1-micro";
const dbVersion = config.get("dbVersion") ?? "POSTGRES_16";
const dbAvailability = config.get("dbAvailability") ?? "ZONAL";
const dbPointInTime = config.getBoolean("dbPointInTime") ?? false;

// --- Auto-generated password (kept out of stack config; secret in state). ----
const dbPassword = new random.RandomPassword("db-password", {
  length: 32,
  special: false,
});

// --- Cloud SQL Postgres instance. --------------------------------------------
// Private vs public is derived from bootstrap.networkId: when a network is
// present we disable public IPv4 and route through the VPC; otherwise we keep a
// public IP and apps reach the instance via the Cloud SQL Auth Proxy socket.
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
      ipConfiguration: networkId.apply((id) =>
        id !== ""
          ? { ipv4Enabled: false, privateNetwork: id }
          : { ipv4Enabled: true },
      ),
    },
  },
  {
    protect: true,
    deleteBeforeReplace: false,
  },
);

const database = new gcp.sql.Database("app-db", {
  instance: dbInstance.name,
  name: "starter",
});

const user = new gcp.sql.User("app-user", {
  instance: dbInstance.name,
  name: "starter",
  password: dbPassword.result,
});

// --- Exports (locked contract — consumed by secrets (P5) / apps (P6)). -------
export const sqlInstanceName = dbInstance.name;
export const dbConnectionName = dbInstance.connectionName;
// Private IP only when a VPC network is present; "" signals public mode to P5.
export const dbPrivateIp = pulumi
  .all([networkId, dbInstance.privateIpAddress])
  .apply(([id, ip]) => (id !== "" ? ip ?? "" : ""));
export const dbName = database.name;
export const dbUser = user.name;
export const dbPassword_ = pulumi.secret(dbPassword.result);
export { dbPassword_ as dbPassword };
