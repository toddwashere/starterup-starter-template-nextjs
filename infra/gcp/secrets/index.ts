import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import * as random from "@pulumi/random";
import {
  SECRET_CATALOG,
  generatedSecrets,
  placeholderSecrets,
  secretsForApp,
} from "../../shared/secret-catalog";
import { APPS } from "../../shared/apps.manifest";
import { composeDatabaseUrl } from "./db-url";

// `secretsForApp` / `APPS` are intentionally referenced so this layer stays in
// lockstep with the shared catalog; the per-app accessor IAM that consumes them
// is granted in the apps layer (P6), which reads the `secretIds` export below.
void secretsForApp;
void APPS;

const config = new pulumi.Config();

// --- Upstream stacks ---------------------------------------------------------
const bootstrapStack = new pulumi.StackReference(config.require("bootstrapStackRef"));
const databaseStack = new pulumi.StackReference(config.require("databaseStackRef"));

const projectId = bootstrapStack.getOutput("projectId") as pulumi.Output<string>;

// Database connection details (see Dependency Contract). dbPrivateIp is "" when
// the instance is public-only (sandbox), driving the Cloud SQL socket form.
const dbConnectionName = databaseStack.getOutput("dbConnectionName") as pulumi.Output<string>;
const dbPrivateIp = databaseStack.getOutput("dbPrivateIp") as pulumi.Output<string>;
const dbName = databaseStack.getOutput("dbName") as pulumi.Output<string>;
const dbUser = databaseStack.getOutput("dbUser") as pulumi.Output<string>;
const dbPassword = databaseStack.getOutput("dbPassword") as pulumi.Output<string>;

const DATABASE_URL_ID = "database-url";

// --- 1. Create a Secret for every catalog entry. -----------------------------
const secrets: Record<string, gcp.secretmanager.Secret> = {};
for (const descriptor of SECRET_CATALOG) {
  secrets[descriptor.id] = new gcp.secretmanager.Secret(descriptor.id, {
    secretId: descriptor.id,
    replication: { auto: {} },
  });
}

// --- 2. Compose DATABASE_URL and store it as the database-url version. --------
const databaseUrl = pulumi
  .all([dbUser, dbPassword, dbName, dbPrivateIp, dbConnectionName])
  .apply(([user, password, name, privateIp, connectionName]) =>
    composeDatabaseUrl({ user, password, dbName: name, privateIp, connectionName }),
  );

new gcp.secretmanager.SecretVersion(`${DATABASE_URL_ID}-v1`, {
  secret: secrets[DATABASE_URL_ID].id,
  secretData: pulumi.secret(databaseUrl),
});

// --- 3. Generated secrets (except database-url) get a random value version. ---
// Placeholder secrets get NO version — dev adds the first value out-of-band via
// `gcloud secrets versions add <id> --data-file=-`. Cloud Run referencing
// version "latest" for a placeholder WILL FAIL until that first value exists;
// this is expected and documented in the apps layer (P6).
for (const descriptor of generatedSecrets()) {
  if (descriptor.id === DATABASE_URL_ID) continue;
  const value = new random.RandomPassword(`${descriptor.id}-value`, {
    length: 32,
    special: false,
  });
  new gcp.secretmanager.SecretVersion(`${descriptor.id}-v1`, {
    secret: secrets[descriptor.id].id,
    secretData: pulumi.secret(value.result),
  });
}

// Placeholder secrets intentionally have no SecretVersion (see note above).
void placeholderSecrets;

// --- Exports (locked contract — see Dependency Contract). ---------------------
// secretIds maps each catalog id to its Secret Manager resource name; P6 reads
// this to wire env references and grant per-secret accessor IAM to app SAs.
export const secretIds: Record<string, pulumi.Output<string>> = Object.fromEntries(
  SECRET_CATALOG.map((d) => [d.id, secrets[d.id].name]),
);
export const databaseUrlSecretName = secrets[DATABASE_URL_ID].name;
export const projectIdOut = projectId;
