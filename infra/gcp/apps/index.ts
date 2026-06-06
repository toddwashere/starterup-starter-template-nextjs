import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { APPS } from "../../shared/apps.manifest";
import { buildAppEnv, appRoles, appSecretAccessorIds } from "./service-config";

const config = new pulumi.Config();
const isProduction = pulumi.getStack() === "production";

const bootstrap = new pulumi.StackReference(config.require("bootstrapStackRef"));
const database = new pulumi.StackReference(config.require("databaseStackRef"));
const storage = new pulumi.StackReference(config.require("storageStackRef"));
const messaging = new pulumi.StackReference(config.require("messagingStackRef"));
const secrets = new pulumi.StackReference(config.require("secretsStackRef"));

const projectId = bootstrap.getOutput("projectId") as pulumi.Output<string>;
const region = bootstrap.getOutput("regionOut") as pulumi.Output<string>;
const vpcConnectorId = bootstrap.getOutput("vpcConnectorId") as pulumi.Output<string>;
const artifactRegistryRepo = bootstrap.getOutput("artifactRegistryRepo") as pulumi.Output<string>;

const dbConnectionName = database.getOutput("dbConnectionName") as pulumi.Output<string>;

const uploadsBucketName = storage.getOutput("uploadsBucketName") as pulumi.Output<string>;

const pubsubTopicName = messaging.getOutput("pubsubTopicName") as pulumi.Output<string>;
const redisHost = messaging.getOutput("redisHost") as pulumi.Output<string>;
const redisPort = messaging.getOutput("redisPort") as pulumi.Output<number>;

const databaseUrlSecretName = secrets.getOutput("databaseUrlSecretName") as pulumi.Output<string>;
const secretIds = secrets.getOutput("secretIds") as pulumi.Output<Record<string, string>>;

const imageRegistry = config.get("imageRegistry")
  ? pulumi.output(config.require("imageRegistry"))
  : artifactRegistryRepo;
const imageTag = config.get("imageTag") ?? "latest";

const services: Record<string, gcp.cloudrunv2.Service> = {};
const serviceAccounts: Record<string, gcp.serviceaccount.Account> = {};

for (const app of APPS) {
  // --- Per-app runtime service account ---------------------------------------
  const sa = new gcp.serviceaccount.Account(`run-${app.name}`, {
    accountId: `run-${app.name}`,
    displayName: `Cloud Run runtime SA for ${app.name}`,
  });
  serviceAccounts[app.name] = sa;

  // Project-level least-privilege roles (empty for www).
  appRoles(app).forEach((role, i) => {
    new gcp.projects.IAMMember(`run-${app.name}-role-${i}`, {
      project: projectId,
      role,
      member: pulumi.interpolate`serviceAccount:${sa.email}`,
    });
  });

  // Per-secret accessor grants (scoped to exactly the secrets this app reads).
  appSecretAccessorIds(app).forEach((secretId) => {
    new gcp.secretmanager.SecretIamMember(`run-${app.name}-secret-${secretId}`, {
      secretId: secretIds.apply((m) => m[secretId]) as pulumi.Output<string>,
      role: "roles/secretmanager.secretAccessor",
      member: pulumi.interpolate`serviceAccount:${sa.email}`,
    });
  });

  // --- Env vars (resolve service-config descriptors to Cloud Run env) ---------
  // Value-bearing env vars depend on StackReference Outputs, so we resolve them
  // together via pulumi.all() and build the EnvContext inside the apply.
  const envInputs = pulumi
    .all([projectId, pubsubTopicName, redisHost, redisPort, uploadsBucketName])
    .apply(([proj, topic, rHost, rPort, bucket]) => {
      const descriptors = buildAppEnv(app, {
        projectId: proj,
        pubsubTopic: topic,
        redisHost: rHost,
        redisPort: rPort,
        uploadsBucket: bucket,
      });
      return descriptors;
    });

  const env: pulumi.Output<gcp.types.input.cloudrunv2.ServiceTemplateContainerEnv[]> =
    pulumi
      .all([envInputs, databaseUrlSecretName, secretIds])
      .apply(([descriptors, dbSecret, idMap]) =>
        descriptors.map((d) => {
          if (d.databaseUrl) {
            return {
              name: d.name,
              valueSource: { secretKeyRef: { secret: dbSecret, version: "latest" } },
            };
          }
          if (d.fromSecretId) {
            return {
              name: d.name,
              valueSource: {
                secretKeyRef: { secret: idMap[d.fromSecretId!], version: "latest" },
              },
            };
          }
          return { name: d.name, value: d.value ?? "" };
        }),
      );

  // --- Probes -----------------------------------------------------------------
  const startupProbe: gcp.types.input.cloudrunv2.ServiceTemplateContainerStartupProbe = {
    httpGet: { path: app.healthPath, port: app.port },
    timeoutSeconds: 5,
    periodSeconds: 5,
    failureThreshold: 6,
  };
  const livenessProbe: gcp.types.input.cloudrunv2.ServiceTemplateContainerLivenessProbe = {
    httpGet: { path: app.healthPath, port: app.port },
    timeoutSeconds: 5,
    periodSeconds: 10,
    failureThreshold: 3,
  };

  const container: gcp.types.input.cloudrunv2.ServiceTemplateContainer = {
    image: pulumi.interpolate`${imageRegistry}/${app.name}:${imageTag}`,
    ports: { containerPort: app.port },
    envs: env,
    startupProbe,
    ...(app.worker ? {} : { livenessProbe }),
  };

  const volumes: gcp.types.input.cloudrunv2.ServiceTemplateVolume[] | undefined = app.needsDb
    ? [{ name: "cloudsql", cloudSqlInstance: { instances: [dbConnectionName] } }]
    : undefined;

  const vpcAccess: pulumi.Input<gcp.types.input.cloudrunv2.ServiceTemplateVpcAccess> | undefined =
    vpcConnectorId.apply((id) =>
      id ? { connector: id, egress: "ALL_TRAFFIC" } : { connector: undefined, egress: undefined },
    );

  services[app.name] = new gcp.cloudrunv2.Service(app.name, {
    name: `starter-${app.name}`,
    location: region,
    ingress: app.worker ? "INGRESS_TRAFFIC_INTERNAL_ONLY" : "INGRESS_TRAFFIC_ALL",
    template: {
      serviceAccount: sa.email,
      maxInstanceRequestConcurrency: app.worker ? 1 : 80,
      scaling: {
        minInstanceCount: isProduction && app.name === "dashboard" ? 1 : 0,
        maxInstanceCount: isProduction ? 10 : 2,
      },
      vpcAccess,
      containers: [container],
      volumes,
    },
  });
}

// --- Public invoker: allUsers ONLY for public apps (never workers). ----------
for (const app of APPS) {
  if (!app.public) continue;
  new gcp.cloudrunv2.ServiceIamMember(`${app.name}-public`, {
    name: services[app.name].name,
    location: region,
    role: "roles/run.invoker",
    member: "allUsers",
  });
}

// --- Exports -----------------------------------------------------------------
export const dashboardUrl = services.dashboard.uri;
export const wwwUrl = services.www.uri;
export const publicApiUrl = services["public-api"].uri;
export const publicMcpUrl = services["public-mcp"].uri;
export const workersUrl = services.workers.uri;
