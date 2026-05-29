import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const coreStackRef = config.require("coreStackRef");
const imageRegistry = config.require("imageRegistry");
const imageTag = config.get("imageTag") ?? "latest";

const coreStack = new pulumi.StackReference(coreStackRef);

// Read core outputs.
const projectId = coreStack.getOutput("projectId") as pulumi.Output<string>;
const regionOutput = coreStack.getOutput("regionOutput") as pulumi.Output<string>;
const databaseUrlSecretName = coreStack.getOutput(
  "databaseUrlSecretName",
) as pulumi.Output<string>;
const pubsubTopicName = coreStack.getOutput(
  "pubsubTopicName",
) as pulumi.Output<string>;
const sqlConnectionName = coreStack.getOutput(
  "sqlConnectionName",
) as pulumi.Output<string>;

interface AppDeploy {
  name: string;
  port: number;
  healthPath: string;
  image: pulumi.Input<string>;
  needsDb?: boolean;
  needsPubsub?: boolean;
  /** Worker = no public ingress, low concurrency, no liveness probe. */
  worker?: boolean;
}

// Mirrors infra/shared/apps.manifest.ts. Pulumi projects aren't in the
// workspace, so we duplicate the small set rather than import across roots.
const apps: AppDeploy[] = [
  {
    name: "dashboard",
    port: 4000,
    healthPath: "/api/health",
    image: pulumi.interpolate`${imageRegistry}/dashboard:${imageTag}`,
    needsDb: true,
  },
  {
    name: "www",
    port: 4001,
    healthPath: "/api/health",
    image: pulumi.interpolate`${imageRegistry}/www:${imageTag}`,
  },
  {
    name: "public-api",
    port: 4002,
    healthPath: "/health",
    image: pulumi.interpolate`${imageRegistry}/public-api:${imageTag}`,
    needsDb: true,
  },
  {
    name: "public-mcp",
    port: 4003,
    healthPath: "/health",
    image: pulumi.interpolate`${imageRegistry}/public-mcp:${imageTag}`,
    needsDb: true,
  },
  {
    name: "workers",
    port: 4300,
    healthPath: "/health",
    image: pulumi.interpolate`${imageRegistry}/workers:${imageTag}`,
    needsDb: true,
    needsPubsub: true,
    worker: true,
  },
];

const services: Record<string, gcp.cloudrunv2.Service> = {};

for (const app of apps) {
  const envVars: gcp.types.input.cloudrunv2.ServiceTemplateContainerEnv[] = [
    { name: "PORT", value: app.port.toString() },
    // Pub/Sub adapter ships in Task 3.4. Until then the env is set but the
    // worker code keeps using its current adapter wiring.
    { name: "WORKER_QUEUE_ADAPTER", value: "pubsub" },
    { name: "BULLMQ_QUEUE_NAME", value: "jobs" },
  ];

  if (app.needsDb) {
    envVars.push({
      name: "DATABASE_URL",
      valueSource: {
        secretKeyRef: {
          secret: databaseUrlSecretName,
          version: "latest",
        },
      },
    });
  }

  if (app.needsPubsub) {
    envVars.push({ name: "PUBSUB_TOPIC", value: pubsubTopicName });
    envVars.push({ name: "GCP_PROJECT_ID", value: projectId });
  }

  const containerPort: gcp.types.input.cloudrunv2.ServiceTemplateContainerPort =
    { containerPort: app.port };

  const startupProbe: gcp.types.input.cloudrunv2.ServiceTemplateContainerStartupProbe =
    {
      httpGet: { path: app.healthPath, port: app.port },
      timeoutSeconds: 5,
      periodSeconds: 5,
      failureThreshold: 6,
    };

  const livenessProbe: gcp.types.input.cloudrunv2.ServiceTemplateContainerLivenessProbe =
    {
      httpGet: { path: app.healthPath, port: app.port },
      timeoutSeconds: 5,
      periodSeconds: 10,
      failureThreshold: 3,
    };

  const container: gcp.types.input.cloudrunv2.ServiceTemplateContainer = {
    image: app.image,
    ports: [containerPort],
    env: envVars,
    startupProbe,
    ...(app.worker ? {} : { livenessProbe }),
  };

  const volumes: gcp.types.input.cloudrunv2.ServiceTemplateVolume[] | undefined =
    app.needsDb
      ? [
          {
            name: "cloudsql",
            cloudSqlInstance: { instances: [sqlConnectionName] },
          },
        ]
      : undefined;

  services[app.name] = new gcp.cloudrunv2.Service(app.name, {
    name: `starter-${app.name}`,
    location: regionOutput,
    ingress: app.worker
      ? "INGRESS_TRAFFIC_INTERNAL_ONLY"
      : "INGRESS_TRAFFIC_ALL",
    template: {
      maxInstanceRequestConcurrency: app.worker ? 1 : 80,
      scaling: {
        minInstanceCount: 0,
        maxInstanceCount: 2, // sandbox cap; CrossGuard enforces (gcp-sandbox)
      },
      containers: [container],
      volumes,
    },
  });
}

// --- IAM: allow unauthenticated for public-facing services ------------------
for (const name of ["dashboard", "www", "public-api", "public-mcp"]) {
  new gcp.cloudrunv2.ServiceIamMember(`${name}-public`, {
    name: services[name].name,
    location: regionOutput,
    role: "roles/run.invoker",
    member: "allUsers",
  });
}

// --- Exports ----------------------------------------------------------------
export const dashboardUrl = services.dashboard.uri;
export const wwwUrl = services.www.uri;
export const publicApiUrl = services["public-api"].uri;
export const publicMcpUrl = services["public-mcp"].uri;
export const workersUrl = services.workers.uri; // internal; for diagnostics
