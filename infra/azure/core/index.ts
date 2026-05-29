import * as pulumi from "@pulumi/pulumi";
import * as azure from "@pulumi/azure-native";
import * as random from "@pulumi/random";

const config = new pulumi.Config();
const location = new pulumi.Config("azure-native").require("location");
const rgName = config.require("resourceGroupName");
const dbSku = config.get("dbSkuName") ?? "Standard_B1ms";
const dbVersion = config.get("dbVersion") ?? "16";

// --- Resource Group --------------------------------------------------------
const rg = new azure.resources.ResourceGroup("starter-rg", {
  resourceGroupName: rgName,
  location,
});

// --- PostgreSQL Flexible Server -------------------------------------------
const dbPassword = new random.RandomPassword("db-password", {
  length: 32,
  special: false,
});

const dbServer = new azure.dbforpostgresql.Server(
  "starter-db",
  {
    resourceGroupName: rg.name,
    serverName: pulumi.interpolate`starter-db-${pulumi.getStack()}`,
    location,
    sku: { name: dbSku, tier: "Burstable" },
    administratorLogin: "starter",
    administratorLoginPassword: dbPassword.result,
    version: dbVersion,
    storage: { storageSizeGB: 32 },
    backup: { backupRetentionDays: 7, geoRedundantBackup: "Disabled" },
    network: { publicNetworkAccess: "Enabled" }, // sandbox; production uses VNet
    highAvailability: { mode: "Disabled" },
  },
  { protect: true, deleteBeforeReplace: false },
);

const _dbName = new azure.dbforpostgresql.Database("app-db", {
  resourceGroupName: rg.name,
  serverName: dbServer.name,
  databaseName: "starter",
});

// Allow Azure services (Container Apps) to reach Postgres.
new azure.dbforpostgresql.FirewallRule("allow-azure", {
  resourceGroupName: rg.name,
  serverName: dbServer.name,
  firewallRuleName: "AllowAllAzureIPs",
  startIpAddress: "0.0.0.0",
  endIpAddress: "0.0.0.0",
});

// --- Service Bus Namespace + Queue + DLQ ----------------------------------
const sbNamespace = new azure.servicebus.Namespace("starter-sb", {
  resourceGroupName: rg.name,
  namespaceName: pulumi.interpolate`starter-sb-${pulumi.getStack()}`,
  location,
  sku: { name: "Basic", tier: "Basic" },
});

const jobsQueue = new azure.servicebus.Queue("jobs", {
  resourceGroupName: rg.name,
  namespaceName: sbNamespace.name,
  queueName: "jobs",
  maxDeliveryCount: 5,
  deadLetteringOnMessageExpiration: true,
});

// Key Vault for DATABASE_URL secret
const kv = new azure.keyvault.Vault("starter-kv", {
  resourceGroupName: rg.name,
  vaultName: pulumi.interpolate`starter-kv-${pulumi.getStack()}`,
  location,
  properties: {
    sku: { family: "A", name: "standard" },
    tenantId: azure.authorization.getClientConfigOutput().tenantId,
    accessPolicies: [], // populate from apps stack when assigning managed identities
    enableRbacAuthorization: true,
  },
});

const databaseUrlInternal = pulumi.interpolate`postgresql://starter:${dbPassword.result}@${dbServer.fullyQualifiedDomainName}/starter?sslmode=require`;

const dbUrlSecret = new azure.keyvault.Secret("database-url", {
  resourceGroupName: rg.name,
  vaultName: kv.name,
  secretName: "database-url",
  properties: { value: databaseUrlInternal },
});

// Service Bus connection string (for adapter env)
const rootKey = azure.servicebus.listNamespaceKeysOutput({
  resourceGroupName: rg.name,
  namespaceName: sbNamespace.name,
  authorizationRuleName: "RootManageSharedAccessKey",
});

// --- Exports ----------------------------------------------------------------
export const resourceGroupName = rg.name;
export const locationOutput = location;
export const databaseUrl = pulumi.secret(databaseUrlInternal);
export const databaseUrlSecretUri = dbUrlSecret.properties.apply((p) => p.secretUri ?? "");
export const serviceBusConnectionString = pulumi.secret(rootKey.primaryConnectionString);
export const serviceBusQueueName = jobsQueue.name;
export const serviceBusNamespace = sbNamespace.name;
export const keyVaultName = kv.name;
