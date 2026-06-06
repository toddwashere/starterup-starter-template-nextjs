import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { APPS } from "../../shared/apps.manifest";
import { buildAppEnv, appRoles, appSecretAccessorIds } from "./service-config";
import { resolveCompliance, type ComplianceMode } from "../../shared/compliance";

const config = new pulumi.Config();
const isProduction = pulumi.getStack() === "production";

const compliance = resolveCompliance(
  (config.get("complianceMode") as ComplianceMode) ?? "none",
  { vpcServiceControls: config.getBoolean("vpcServiceControls") ?? undefined },
);

// Org-level Access Context Manager access policy id (numeric). Required for VPC-SC.
const accessPolicyId = config.get("accessPolicyId");

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
    // Binary Authorization: requires the bootstrap binauthz project policy (same
    // complianceMode must be set on both layers for the policy to exist).
    ...(compliance.binaryAuthorization
      ? { binaryAuthorization: { useDefault: true } }
      : {}),
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

// --- Migration runner: executed by the app release pipeline (P7), not Pulumi. -
// `gcloud run jobs execute starter-migrate --wait` runs prisma migrate deploy
// as a gate before traffic shifts to new revisions.
const migrateJob = new gcp.cloudrunv2.Job("migrate", {
  name: "starter-migrate",
  location: region,
  template: {
    template: {
      serviceAccount: serviceAccounts.dashboard.email,
      containers: [
        {
          image: pulumi.interpolate`${imageRegistry}/dashboard:${imageTag}`,
          commands: ["pnpm"],
          args: ["--filter", "@workspace/database", "exec", "prisma", "migrate", "deploy"],
          envs: [
            {
              name: "DATABASE_URL",
              valueSource: {
                secretKeyRef: { secret: databaseUrlSecretName, version: "latest" },
              },
            },
          ],
          volumeMounts: [{ name: "cloudsql", mountPath: "/cloudsql" }],
        },
      ],
      volumes: [{ name: "cloudsql", cloudSqlInstance: { instances: [dbConnectionName] } }],
    },
  },
});

// --- Optional: global HTTPS LB + Cloud Armor + Certificate Manager -----------
const enableHttpsLb = config.getBoolean("enableHttpsLb") ?? false;
let lbIpAddressOut: pulumi.Output<string> = pulumi.output("");
let dnsAuthorizationRecordsOut: pulumi.Output<unknown> = pulumi.output([]);

if (enableHttpsLb && pulumi.getStack() !== "sandbox") {
  const baseDomain = config.require("lbDomain");
  // host -> app routing
  const hosts: { host: string; app: string }[] = [
    { host: `app.${baseDomain}`, app: "dashboard" },
    { host: `api.${baseDomain}`, app: "public-api" },
    { host: `mcp.${baseDomain}`, app: "public-mcp" },
    { host: baseDomain, app: "www" },
  ];

  // P6 owns the LB + base Cloud Armor policy (built only when enableHttpsLb).
  // P8 adds rate-limit rules + adaptive protection when compliance.cloudArmor.
  // When compliant, the stricter rule (count: 100/min) supersedes the base rule
  // (count: 600/min); adaptive protection is also enabled for L7 DDoS defense.
  const complianceArmorRules = compliance.cloudArmor
    ? [
        {
          action: "rate_based_ban",
          priority: 900,
          match: {
            versionedExpr: "SRC_IPS_V1",
            config: { srcIpRanges: ["*"] },
          },
          rateLimitOptions: {
            conformAction: "allow",
            exceedAction: "deny(429)",
            enforceOnKey: "IP",
            rateLimitThreshold: { count: 100, intervalSec: 60 },
          },
          description: "Per-IP rate limiting (compliance).",
        },
      ]
    : [];

  // Cloud Armor security policy (rate limit + deny known-bad).
  const armor = new gcp.compute.SecurityPolicy("starter-armor", {
    rules: [
      ...complianceArmorRules,
      {
        action: "allow",
        priority: 2147483647,
        match: { versionedExpr: "SRC_IPS_V1", config: { srcIpRanges: ["*"] } },
        description: "default allow",
      },
      {
        action: "rate_based_ban",
        priority: 1000,
        match: { versionedExpr: "SRC_IPS_V1", config: { srcIpRanges: ["*"] } },
        rateLimitOptions: {
          conformAction: "allow",
          exceedAction: "deny(429)",
          enforceOnKey: "IP",
          rateLimitThreshold: { count: 600, intervalSec: 60 },
        },
        description: "rate limit per IP",
      },
    ],
    ...(compliance.cloudArmor
      ? {
          adaptiveProtectionConfig: {
            layer7DdosDefenseConfig: { enable: true },
          },
        }
      : {}),
  });

  // One serverless NEG + backend per public app.
  const backends: Record<string, gcp.compute.BackendService> = {};
  for (const { app } of hosts) {
    const neg = new gcp.compute.RegionNetworkEndpointGroup(`${app}-neg`, {
      region,
      networkEndpointType: "SERVERLESS",
      cloudRun: { service: services[app].name },
    });
    backends[app] = new gcp.compute.BackendService(`${app}-backend`, {
      protocol: "HTTP",
      loadBalancingScheme: "EXTERNAL_MANAGED",
      securityPolicy: armor.id,
      backends: [{ group: neg.id }],
    });
  }

  // URL map with host rules.
  const urlMap = new gcp.compute.URLMap("starter-url-map", {
    defaultService: backends.www.id,
    hostRules: hosts.map(({ host, app }) => ({ hosts: [host], pathMatcher: app })),
    pathMatchers: hosts.map(({ app }) => ({
      name: app,
      defaultService: backends[app].id,
    })),
  });

  // Certificate Manager: DNS authorization (one per host) + managed cert.
  const dnsAuths = hosts.map(
    ({ host }) =>
      new gcp.certificatemanager.DnsAuthorization(`dnsauth-${host.replace(/\./g, "-")}`, {
        domain: host,
      }),
  );
  const cert = new gcp.certificatemanager.Certificate("starter-cert", {
    managed: {
      domains: hosts.map((h) => h.host),
      dnsAuthorizations: dnsAuths.map((d) => d.id),
    },
  });
  const certMap = new gcp.certificatemanager.CertificateMap("starter-cert-map", {});
  hosts.forEach(({ host }, i) => {
    new gcp.certificatemanager.CertificateMapEntry(`cme-${i}`, {
      map: certMap.name,
      hostname: host,
      certificates: [cert.id],
    });
  });

  const lbIp = new gcp.compute.GlobalAddress("starter-lb-ip", {});
  const httpsProxy = new gcp.compute.TargetHttpsProxy("starter-https-proxy", {
    urlMap: urlMap.id,
    certificateMap: pulumi.interpolate`//certificatemanager.googleapis.com/${certMap.id}`,
  });
  new gcp.compute.GlobalForwardingRule("starter-lb", {
    target: httpsProxy.id,
    ipAddress: lbIp.address,
    portRange: "443",
    loadBalancingScheme: "EXTERNAL_MANAGED",
  });

  lbIpAddressOut = lbIp.address;
  // DNS records the operator must add at the external registrar:
  // (a) A records: each host -> lbIp.address
  // (b) the DNS-authorization CNAMEs below (provision certs independently).
  dnsAuthorizationRecordsOut = pulumi
    .all(dnsAuths.map((d) => d.dnsResourceRecords))
    .apply((recs) => recs.flat());
}

// --- Optional: uptime checks + alert policies --------------------------------
const enableMonitoring = config.getBoolean("enableMonitoring") ?? false;

if (enableMonitoring) {
  const channel = new gcp.monitoring.NotificationChannel("alert-email", {
    type: "email",
    labels: { email_address: config.require("alertEmail") },
  });

  for (const app of APPS) {
    if (!app.public) continue;
    // `uri` is "https://..." — strip scheme so monitoredResource.labels.host gets a bare hostname.
    const hostLabel = services[app.name].uri.apply((u) => u.replace(/^https?:\/\//, ""));
    const check = new gcp.monitoring.UptimeCheckConfig(`uptime-${app.name}`, {
      displayName: `uptime-${app.name}`,
      timeout: "10s",
      period: "300s",
      httpCheck: { path: app.healthPath, port: 443, useSsl: true, requestMethod: "GET" },
      monitoredResource: {
        type: "uptime_url",
        labels: { project_id: projectId, host: hostLabel },
      },
    });

    new gcp.monitoring.AlertPolicy(`alert-${app.name}`, {
      displayName: `${app.name} uptime failed`,
      combiner: "OR",
      notificationChannels: [channel.id],
      conditions: [
        {
          displayName: `${app.name} uptime check failing`,
          conditionThreshold: {
            filter: pulumi.interpolate`metric.type="monitoring.googleapis.com/uptime_check/check_passed" AND resource.type="uptime_url" AND metric.label.check_id="${check.uptimeCheckId}"`,
            comparison: "COMPARISON_LT",
            thresholdValue: 1,
            duration: "300s",
            trigger: { count: 1 },
            aggregations: [
              {
                alignmentPeriod: "300s",
                perSeriesAligner: "ALIGN_NEXT_OLDER",
                crossSeriesReducer: "REDUCE_COUNT_FALSE",
                groupByFields: ["resource.label.host"],
              },
            ],
          },
        },
      ],
    });
  }
}

// --- VPC Service Controls perimeter (optional sub-flag; off by default). ------
// VPC-SC is org-scoped and disabled by default; enabling it without a correct
// access policy + access levels can lock out legitimate access, so it is
// intentionally opt-in via vpcServiceControls: true AND accessPolicyId.
// Requires an org-level Access Context Manager access policy. Gated on BOTH the
// compliance sub-flag and a configured accessPolicyId to avoid a broken apply.
if (compliance.vpcServiceControls && accessPolicyId) {
  new gcp.accesscontextmanager.ServicePerimeter("starter-vpc-sc", {
    parent: `accessPolicies/${accessPolicyId}`,
    name: `accessPolicies/${accessPolicyId}/servicePerimeters/starter_${pulumi.getStack()}`,
    title: `starter-${pulumi.getStack()}`,
    status: {
      restrictedServices: [
        "run.googleapis.com",
        "sqladmin.googleapis.com",
        "storage.googleapis.com",
        "pubsub.googleapis.com",
        "secretmanager.googleapis.com",
        "cloudkms.googleapis.com",
      ],
      resources: [pulumi.interpolate`projects/${projectId}`],
    },
  });
}

// --- Exports -----------------------------------------------------------------
export const dashboardUrl = services.dashboard.uri;
export const wwwUrl = services.www.uri;
export const publicApiUrl = services["public-api"].uri;
export const publicMcpUrl = services["public-mcp"].uri;
export const workersUrl = services.workers.uri;
export const migrateJobName = migrateJob.name;
export const lbIpAddress = lbIpAddressOut;
export const dnsAuthorizationRecords = dnsAuthorizationRecordsOut;
