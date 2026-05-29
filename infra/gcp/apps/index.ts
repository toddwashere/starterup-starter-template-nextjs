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
// Production networking outputs (empty string in sandbox).
const vpcConnectorId = coreStack.getOutput("vpcConnectorId") as pulumi.Output<string>;

// Production differentiation.
const isProduction = pulumi.getStack() === "production";

// Optional HTTPS LB (production only, off by default).
const enableHttpsLb = config.getBoolean("enableHttpsLb") ?? false;
// Optional canary traffic split (production only).
const canaryRevision = config.get("canaryRevision");
const canaryPercent = config.getNumber("canaryPercent");

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

  // VPC access: wire the connector when core reports one (production stacks
  // with `privateNetwork: true`). Falls back to undefined for sandbox.
  const vpcAccess = vpcConnectorId.apply((id) =>
    id
      ? ({
          connector: id,
          egress: "ALL_TRAFFIC",
        } as gcp.types.input.cloudrunv2.ServiceTemplateVpcAccess)
      : undefined,
  );

  services[app.name] = new gcp.cloudrunv2.Service(app.name, {
    name: `starter-${app.name}`,
    location: regionOutput,
    ingress: app.worker
      ? "INGRESS_TRAFFIC_INTERNAL_ONLY"
      : "INGRESS_TRAFFIC_ALL",
    template: {
      maxInstanceRequestConcurrency: app.worker ? 1 : 80,
      scaling: {
        // Keep the dashboard warm in production to avoid cold-start latency.
        // All other services (including workers) scale to zero.
        minInstanceCount: isProduction && app.name === "dashboard" ? 1 : 0,
        // Raise the cap in production; CrossGuard enforces sandbox limit of 2.
        maxInstanceCount: isProduction ? 10 : 2,
      },
      vpcAccess,
      containers: [container],
      volumes,
    },
  });
}

// --- IAM: allow unauthenticated for public-facing services -------------------
for (const name of ["dashboard", "www", "public-api", "public-mcp"]) {
  new gcp.cloudrunv2.ServiceIamMember(`${name}-public`, {
    name: services[name].name,
    location: regionOutput,
    role: "roles/run.invoker",
    member: "allUsers",
  });
}

// --- Optional: global HTTPS load balancer for production dashboard -----------
// Gated by `enableHttpsLb: true` in Pulumi.production.yaml.
// NOTE: CrossGuard sandbox policy denies GlobalForwardingRule; this block only
// fires on the production stack so the policy guard is never triggered.
// Requires DNS A record pointing to the reserved IP and a managed cert domain.
if (enableHttpsLb && isProduction) {
  const neg = new gcp.compute.RegionNetworkEndpointGroup("dashboard-neg", {
    region: regionOutput,
    networkEndpointType: "SERVERLESS",
    cloudRun: { service: services.dashboard.name },
  });

  const backendService = new gcp.compute.BackendService("dashboard-backend", {
    protocol: "HTTP",
    loadBalancingScheme: "EXTERNAL_MANAGED",
    backends: [{ group: neg.id }],
  });

  const urlMap = new gcp.compute.URLMap("dashboard-url-map", {
    defaultService: backendService.id,
  });

  const managedCert = new gcp.compute.ManagedSslCertificate(
    "dashboard-cert",
    {
      managed: {
        // Domain populated from config; operator must set DNS before enabling LB.
        domains: [config.require("lbDomain")],
      },
    },
  );

  const httpsProxy = new gcp.compute.TargetHttpsProxy("dashboard-https-proxy", {
    urlMap: urlMap.id,
    sslCertificates: [managedCert.id],
  });

  const lbIp = new gcp.compute.GlobalAddress("dashboard-lb-ip", {});

  new gcp.compute.GlobalForwardingRule("dashboard-lb", {
    target: httpsProxy.id,
    ipAddress: lbIp.address,
    portRange: "443",
    loadBalancingScheme: "EXTERNAL_MANAGED",
  });
}

// --- Optional: canary traffic split ------------------------------------------
// Activated by setting `canaryRevision` + `canaryPercent` in stack config.
// Only fires on the production stack.
if (isProduction && canaryRevision && canaryPercent !== undefined) {
  // Replace the dashboard service traffic config with a weighted split between
  // the latest revision and the pinned canary revision.
  // NOTE: Pulumi models this as a separate `traffic` argument on the Service
  // resource. We recreate the resource with the traffic block applied.
  // In practice operators update the existing service definition; this block
  // is scaffolding that shows the traffic shape — wire it into the service
  // definition above when you're ready to activate canary deploys.
  //
  // Example traffic block to add to the Service template above:
  //
  //   traffic: [
  //     {
  //       type: "TRAFFIC_TARGET_ALLOCATION_TYPE_LATEST",
  //       percent: 100 - canaryPercent,
  //     },
  //     {
  //       type: "TRAFFIC_TARGET_ALLOCATION_TYPE_REVISION",
  //       revision: canaryRevision,
  //       percent: canaryPercent,
  //     },
  //   ],
  //
  // See: https://www.pulumi.com/registry/packages/gcp/api-docs/cloudrunv2/service/
  void canaryRevision; // referenced so TypeScript doesn't drop the variable
  void canaryPercent;
}

// --- Exports -----------------------------------------------------------------
export const dashboardUrl = services.dashboard.uri;
export const wwwUrl = services.www.uri;
export const publicApiUrl = services["public-api"].uri;
export const publicMcpUrl = services["public-mcp"].uri;
export const workersUrl = services.workers.uri; // internal; for diagnostics
