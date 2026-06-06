# GCP IaC P6 — apps Layer Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development or superpowers:executing-plans to implement task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Expand the `infra/gcp/apps/` Pulumi project to provision all five apps as Cloud Run services driven by the shared manifest, each with its own least-privilege runtime service account (incl. per-secret accessor grants), plus a `migrate` Cloud Run Job, a flag-gated global HTTPS load balancer (Cloud Armor + Certificate Manager DNS-authorization certs + host routing), and flag-gated Cloud Monitoring uptime checks/alerts.

**Architecture:** The layer reads `bootstrap`, `database`, `messaging`, and `secrets` outputs via `pulumi.StackReference`. Pure env/IAM derivation lives in `infra/gcp/apps/service-config.ts` (Vitest-unit-tested); `index.ts` consumes the shared `APPS` manifest + `planAppIam` + `secretsForApp` so the service/SA/IAM definitions can never drift from the single source of truth.

**Tech Stack:** Pulumi (`@pulumi/pulumi` ^3, `@pulumi/gcp` ^8), TypeScript ^5.7, Vitest ^3. Imports the shared modules created in P1 (`infra/shared/apps.manifest.ts`, `app-iam.ts`, `secret-catalog.ts`).

**Design spec:** [`docs/superpowers/specs/2026-06-06-gcp-comprehensive-iac-design.md`](../specs/2026-06-06-gcp-comprehensive-iac-design.md)

---

## Layer contract

**Consumes (StackReference config keys under `starter-gcp-apps:`):**

| Config key | Stack | Outputs read |
|------------|-------|--------------|
| `bootstrapStackRef` | bootstrap | `projectId`, `regionOut`, `vpcConnectorId` (""), `artifactRegistryRepo`, `complianceModeOut` |
| `databaseStackRef` | database | `dbConnectionName`, `dbPrivateIp` ("") |
| `storageStackRef` | storage | `uploadsBucketName` |
| `messagingStackRef` | messaging | `pubsubTopicName`, `redisHost` (""), `redisPort` |
| `secretsStackRef` | secrets | `secretIds` (map id→Secret Manager resource name), `databaseUrlSecretName` |

Other config: `imageRegistry` (default = bootstrap `artifactRegistryRepo`; override allowed), `imageTag` (default `latest`), `enableHttpsLb` (default false), `lbDomain`, `enableMonitoring` (default false), `alertEmail`.

**Exports:** `dashboardUrl`, `wwwUrl`, `publicApiUrl`, `publicMcpUrl`, `workersUrl`, `migrateJobName`; when LB on: `lbIpAddress`, `dnsAuthorizationRecords`.

## File Structure

- Modify: `infra/gcp/apps/package.json` — add `vitest` devDep + `test` scripts
- Modify: `infra/gcp/apps/tsconfig.json` — `include` `../../shared/*.ts`
- Create: `infra/gcp/apps/service-config.ts` — pure env-var + per-app SA/IAM derivation
- Create: `infra/gcp/apps/service-config.test.ts` — L1 unit tests
- Modify: `infra/gcp/apps/index.ts` — full rewrite deriving from shared manifest
- Create: `infra/gcp/apps/apps.mock.test.ts` — L2 Pulumi mock test
- Modify: `infra/gcp/apps/Pulumi.sandbox.yaml`, `Pulumi.staging.yaml` (create), `Pulumi.production.yaml`

## Critical Tests

- `infra/gcp/apps/service-config.test.ts`: `buildAppEnv` gives `www` no `DATABASE_URL` and no secret env vars; `dashboard` gets `DATABASE_URL` + `BETTER_AUTH_SECRET` env (sourced from secrets); `workers` gets `PUBSUB_TOPIC`, `GCP_PROJECT_ID`, `WORKER_QUEUE_ADAPTER=pubsub`; `REDIS_URL` present only when `usesRedis` and `redisHost` non-empty; per-app SA roles equal `planAppIam(app).roles`; `publicInvokerApps()` returns exactly the `public` apps (never `workers`).
- `infra/gcp/apps/apps.mock.test.ts`: every app yields a Cloud Run service with its own `serviceAccount`; `workers` service has `INGRESS_TRAFFIC_INTERNAL_ONLY` and no `allUsers` invoker binding; a `starter-migrate` Job exists; in sandbox no `GlobalForwardingRule` is created (LB off).

---

## Task 1: Extend project config (deps, tsconfig, stack YAMLs)

**Files:**
- Modify: `infra/gcp/apps/package.json`
- Modify: `infra/gcp/apps/tsconfig.json`
- Modify: `infra/gcp/apps/Pulumi.sandbox.yaml`
- Create: `infra/gcp/apps/Pulumi.staging.yaml`
- Modify: `infra/gcp/apps/Pulumi.production.yaml`

- [ ] **Step 1: Update `package.json`** to add Vitest + test scripts

```json
{
  "name": "starter-gcp-apps",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "index.ts",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@pulumi/gcp": "^8",
    "@pulumi/pulumi": "^3"
  },
  "devDependencies": {
    "@types/node": "^24",
    "typescript": "^5.7",
    "vitest": "^3"
  }
}
```

- [ ] **Step 2: Update `tsconfig.json`** to compile shared modules

```json
{
  "compilerOptions": {
    "target": "es2022",
    "module": "esnext",
    "moduleResolution": "node",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "outDir": "./dist"
  },
  "include": ["*.ts", "../../shared/*.ts"]
}
```

- [ ] **Step 3: Replace `Pulumi.sandbox.yaml`**

```yaml
config:
  gcp:project: "your-sandbox-project-id"
  gcp:region: "us-central1"
  starter-gcp-apps:bootstrapStackRef: "organization/starter-gcp-bootstrap/sandbox"
  starter-gcp-apps:databaseStackRef: "organization/starter-gcp-database/sandbox"
  starter-gcp-apps:storageStackRef: "organization/starter-gcp-storage/sandbox"
  starter-gcp-apps:messagingStackRef: "organization/starter-gcp-messaging/sandbox"
  starter-gcp-apps:secretsStackRef: "organization/starter-gcp-secrets/sandbox"
  starter-gcp-apps:imageTag: "latest"
  starter-gcp-apps:enableHttpsLb: "false"
  starter-gcp-apps:enableMonitoring: "false"
```

- [ ] **Step 4: Create `Pulumi.staging.yaml`**

```yaml
config:
  gcp:project: "your-staging-project-id"
  gcp:region: "us-central1"
  starter-gcp-apps:bootstrapStackRef: "organization/starter-gcp-bootstrap/staging"
  starter-gcp-apps:databaseStackRef: "organization/starter-gcp-database/staging"
  starter-gcp-apps:storageStackRef: "organization/starter-gcp-storage/staging"
  starter-gcp-apps:messagingStackRef: "organization/starter-gcp-messaging/staging"
  starter-gcp-apps:secretsStackRef: "organization/starter-gcp-secrets/staging"
  starter-gcp-apps:imageTag: "v0.1.0"
  starter-gcp-apps:enableHttpsLb: "false"
  starter-gcp-apps:enableMonitoring: "true"
  starter-gcp-apps:alertEmail: "alerts@example.com"
```

- [ ] **Step 5: Replace `Pulumi.production.yaml`**

```yaml
config:
  gcp:project: "your-prod-project-id"
  gcp:region: "us-central1"
  starter-gcp-apps:bootstrapStackRef: "organization/starter-gcp-bootstrap/production"
  starter-gcp-apps:databaseStackRef: "organization/starter-gcp-database/production"
  starter-gcp-apps:storageStackRef: "organization/starter-gcp-storage/production"
  starter-gcp-apps:messagingStackRef: "organization/starter-gcp-messaging/production"
  starter-gcp-apps:secretsStackRef: "organization/starter-gcp-secrets/production"
  starter-gcp-apps:imageTag: "v0.1.0"
  starter-gcp-apps:enableHttpsLb: "true"
  starter-gcp-apps:lbDomain: "example.com"
  starter-gcp-apps:enableMonitoring: "true"
  starter-gcp-apps:alertEmail: "alerts@example.com"
```

- [ ] **Step 6: Commit**

```bash
git add infra/gcp/apps/package.json infra/gcp/apps/tsconfig.json infra/gcp/apps/Pulumi.sandbox.yaml infra/gcp/apps/Pulumi.staging.yaml infra/gcp/apps/Pulumi.production.yaml
git commit -m "chore(infra): apps layer config for shared manifest + multi-env"
```

## Task 2: Pure service-config helper (`service-config.ts`)

**Files:**
- Create: `infra/gcp/apps/service-config.test.ts`
- Create: `infra/gcp/apps/service-config.ts`

- [ ] **Step 1: Write the failing test** (`infra/gcp/apps/service-config.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { buildAppEnv, appRoles, publicInvokerApps, type EnvContext } from "./service-config";
import { APPS_BY_NAME } from "../../shared/apps.manifest";
import { planAppIam } from "../../shared/app-iam";

const ctx: EnvContext = {
  projectId: "test-project",
  pubsubTopic: "jobs-sandbox",
  redisHost: "",
  redisPort: 0,
  uploadsBucket: "test-project-uploads-sandbox",
};

function envNames(app: keyof typeof APPS_BY_NAME, c: EnvContext = ctx): string[] {
  return buildAppEnv(APPS_BY_NAME[app], c).map((e) => e.name);
}

describe("buildAppEnv", () => {
  it("www gets no DATABASE_URL and no secret env vars", () => {
    const names = envNames("www");
    expect(names).not.toContain("DATABASE_URL");
    expect(names).not.toContain("BETTER_AUTH_SECRET");
    expect(names).toContain("PORT");
  });

  it("dashboard gets DATABASE_URL and BETTER_AUTH_SECRET", () => {
    const names = envNames("dashboard");
    expect(names).toContain("DATABASE_URL");
    expect(names).toContain("BETTER_AUTH_SECRET");
  });

  it("workers get pubsub env and adapter", () => {
    const names = envNames("workers");
    expect(names).toContain("PUBSUB_TOPIC");
    expect(names).toContain("GCP_PROJECT_ID");
    expect(names).toContain("WORKER_QUEUE_ADAPTER");
  });

  it("REDIS_URL only when usesRedis and redisHost present", () => {
    expect(envNames("dashboard")).not.toContain("REDIS_URL");
    const withRedis = envNames("dashboard", { ...ctx, redisHost: "10.0.0.3", redisPort: 6379 });
    expect(withRedis).toContain("REDIS_URL");
  });

  it("GCS_UPLOADS_BUCKET only for needsStorage apps with a bucket", () => {
    expect(envNames("dashboard")).toContain("GCS_UPLOADS_BUCKET");
    expect(envNames("www")).not.toContain("GCS_UPLOADS_BUCKET");
    expect(envNames("public-mcp")).not.toContain("GCS_UPLOADS_BUCKET");
  });
});

describe("appRoles", () => {
  it("matches planAppIam roles", () => {
    expect(appRoles(APPS_BY_NAME.dashboard)).toEqual(planAppIam(APPS_BY_NAME.dashboard).roles);
  });
});

describe("publicInvokerApps", () => {
  it("returns public apps only, never workers", () => {
    const names = publicInvokerApps().map((a) => a.name);
    expect(names).toContain("dashboard");
    expect(names).toContain("www");
    expect(names).not.toContain("workers");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd infra/gcp/apps && pnpm install && pnpm vitest run service-config.test.ts`
Expected: FAIL — cannot resolve `./service-config`.

- [ ] **Step 3: Write the implementation** (`infra/gcp/apps/service-config.ts`)

```ts
import type { AppDescriptor } from "../../shared/apps.manifest";
import { APPS } from "../../shared/apps.manifest";
import { planAppIam } from "../../shared/app-iam";
import { secretsForApp } from "../../shared/secret-catalog";

export interface EnvContext {
  projectId: string;
  pubsubTopic: string;
  redisHost: string;
  redisPort: number;
  uploadsBucket: string;
}

/** A Cloud Run env var: either a literal value or a Secret Manager reference id. */
export interface AppEnvVar {
  name: string;
  /** Literal value, when this is a plain env var. */
  value?: string;
  /** Secret catalog id to source from (resolved to a secretKeyRef in index.ts). */
  fromSecretId?: string;
  /** True when this env should come from the composed DATABASE_URL secret. */
  databaseUrl?: boolean;
}

export function buildAppEnv(app: AppDescriptor, ctx: EnvContext): AppEnvVar[] {
  const env: AppEnvVar[] = [{ name: "PORT", value: String(app.port) }];

  if (app.needsDb) {
    env.push({ name: "DATABASE_URL", databaseUrl: true });
  }

  for (const secret of secretsForApp(app.name)) {
    if (secret.id === "database-url") continue; // handled above
    env.push({ name: secret.envVar, fromSecretId: secret.id });
  }

  if (app.needsPubsub || app.worker) {
    env.push({ name: "PUBSUB_TOPIC", value: ctx.pubsubTopic });
    env.push({ name: "GCP_PROJECT_ID", value: ctx.projectId });
    env.push({ name: "WORKER_QUEUE_ADAPTER", value: "pubsub" });
    env.push({ name: "BULLMQ_QUEUE_NAME", value: "jobs" });
  }

  if (app.usesRedis && ctx.redisHost) {
    env.push({ name: "REDIS_URL", value: `redis://${ctx.redisHost}:${ctx.redisPort}` });
  }

  if (app.needsStorage && ctx.uploadsBucket) {
    env.push({ name: "GCS_UPLOADS_BUCKET", value: ctx.uploadsBucket });
  }

  return env;
}

export function appRoles(app: AppDescriptor): string[] {
  return planAppIam(app).roles;
}

export function appSecretAccessorIds(app: AppDescriptor): string[] {
  return planAppIam(app).secretAccessorIds;
}

export function publicInvokerApps(): AppDescriptor[] {
  return APPS.filter((a) => a.public);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd infra/gcp/apps && pnpm vitest run service-config.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add infra/gcp/apps/service-config.ts infra/gcp/apps/service-config.test.ts
git commit -m "feat(infra): pure app env + iam derivation for apps layer"
```

## Task 3: Rewrite `index.ts` — StackReferences, SAs, Cloud Run, invokers

**Files:**
- Modify: `infra/gcp/apps/index.ts`

- [ ] **Step 1: Write the implementation** (`infra/gcp/apps/index.ts`)

Replace the entire file with:

```ts
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
      secretId: secretIds.apply((m) => m[secretId]),
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
                secretKeyRef: { secret: idMap[d.fromSecretId], version: "latest" },
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
    ports: [{ containerPort: app.port }],
    env,
    startupProbe,
    ...(app.worker ? {} : { livenessProbe }),
  };

  const volumes: gcp.types.input.cloudrunv2.ServiceTemplateVolume[] | undefined = app.needsDb
    ? [{ name: "cloudsql", cloudSqlInstance: { instances: [dbConnectionName] } }]
    : undefined;

  const vpcAccess = vpcConnectorId.apply((id) =>
    id
      ? ({ connector: id, egress: "ALL_TRAFFIC" } as gcp.types.input.cloudrunv2.ServiceTemplateVpcAccess)
      : undefined,
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
```

- [ ] **Step 2: Type-check**

Run: `cd infra/gcp/apps && npx tsc --noEmit`
Expected: PASS. If `secretIds.apply((m) => m[secretId])` is not accepted as a `secretId` input, wrap with `pulumi.interpolate` or cast to `pulumi.Output<string>`; adjust and re-run until clean.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/apps/index.ts
git commit -m "feat(infra): apps layer cloud run + per-app SAs from shared manifest"
```

## Task 4: `migrate` Cloud Run Job

**Files:**
- Modify: `infra/gcp/apps/index.ts`

- [ ] **Step 1: Add the migrate Job** before the Exports block

```ts
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
          env: [
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
```

- [ ] **Step 2: Add the export** in the Exports block

```ts
export const migrateJobName = migrateJob.name;
```

- [ ] **Step 3: Type-check**

Run: `cd infra/gcp/apps && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add infra/gcp/apps/index.ts
git commit -m "feat(infra): migrate cloud run job for app release pipeline"
```

## Task 5: Flag-gated global HTTPS LB + Cloud Armor + Certificate Manager (DNS auth)

**Files:**
- Modify: `infra/gcp/apps/index.ts`

- [ ] **Step 1: Add the LB block** before the Exports block

Only fires when `enableHttpsLb` is true and the stack is not sandbox (so the CrossGuard `no-global-forwarding-rules-in-sandbox` policy is never triggered).

```ts
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

  // Cloud Armor security policy (rate limit + deny known-bad).
  const armor = new gcp.compute.SecurityPolicy("starter-armor", {
    rules: [
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
```

- [ ] **Step 2: Add the exports** in the Exports block

```ts
export const lbIpAddress = lbIpAddressOut;
export const dnsAuthorizationRecords = dnsAuthorizationRecordsOut;
```

- [ ] **Step 3: Type-check**

Run: `cd infra/gcp/apps && npx tsc --noEmit`
Expected: PASS. If `dnsResourceRecords` property name differs in the installed `@pulumi/gcp` version, consult `node_modules/@pulumi/gcp/certificatemanager/dnsAuthorization.d.ts` for the correct output field and adjust.

- [ ] **Step 4: Commit**

```bash
git add infra/gcp/apps/index.ts
git commit -m "feat(infra): flag-gated https lb + cloud armor + cert manager dns auth"
```

## Task 6: Flag-gated monitoring (uptime checks + alerts)

**Files:**
- Modify: `infra/gcp/apps/index.ts`

- [ ] **Step 1: Add the monitoring block** before the Exports block

```ts
const enableMonitoring = config.getBoolean("enableMonitoring") ?? false;

if (enableMonitoring) {
  const channel = new gcp.monitoring.NotificationChannel("alert-email", {
    type: "email",
    labels: { email_address: config.require("alertEmail") },
  });

  for (const app of APPS) {
    if (!app.public) continue;
    const check = new gcp.monitoring.UptimeCheckConfig(`uptime-${app.name}`, {
      displayName: `uptime-${app.name}`,
      timeout: "10s",
      period: "300s",
      httpCheck: { path: app.healthPath, port: 443, useSsl: true, requestMethod: "GET" },
      monitoredResource: {
        type: "uptime_url",
        labels: { project_id: projectId, host: services[app.name].uri },
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
              { alignmentPeriod: "300s", perSeriesAligner: "ALIGN_NEXT_OLDER", crossSeriesReducer: "REDUCE_COUNT_FALSE", groupByFields: ["resource.label.host"] },
            ],
          },
        },
      ],
    });
  }
}
```

- [ ] **Step 2: Type-check**

Run: `cd infra/gcp/apps && npx tsc --noEmit`
Expected: PASS. The `monitoredResource.labels.host` expects a string; if the `uri` Output is rejected, wrap the host label using `.apply()` to strip the scheme, then re-run.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/apps/index.ts
git commit -m "feat(infra): flag-gated uptime checks and alert policies"
```

## Task 7: L2 Pulumi mock test (`apps.mock.test.ts`)

**Files:**
- Create: `infra/gcp/apps/apps.mock.test.ts`

- [ ] **Step 1: Write the test** (`infra/gcp/apps/apps.mock.test.ts`)

```ts
import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

describe("apps layer (mocked, sandbox)", () => {
  const created: { type: string; name: string; inputs: Record<string, unknown> }[] = [];
  let infra: typeof import("./index");

  beforeAll(async () => {
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          created.push({ type: args.type, name: args.name, inputs: args.inputs });
          return { id: `${args.name}-id`, state: { ...args.inputs, uri: `https://${args.name}.run.app` } };
        },
        call: (args) => {
          // StackReference outputs needed by index.ts.
          if (args.token.includes("getOutput")) return args.inputs;
          return args.inputs;
        },
      },
      "starter-gcp-apps",
      "sandbox",
    );
    pulumi.runtime.setAllConfig({
      "starter-gcp-apps:bootstrapStackRef": "organization/starter-gcp-bootstrap/sandbox",
      "starter-gcp-apps:databaseStackRef": "organization/starter-gcp-database/sandbox",
      "starter-gcp-apps:storageStackRef": "organization/starter-gcp-storage/sandbox",
      "starter-gcp-apps:messagingStackRef": "organization/starter-gcp-messaging/sandbox",
      "starter-gcp-apps:secretsStackRef": "organization/starter-gcp-secrets/sandbox",
    });
    infra = await import("./index");
    // Touch an export to force graph evaluation.
    await new Promise<string>((res) => infra.workersUrl.apply((v) => (res(v), v)));
  });

  it("creates a Cloud Run service per app", () => {
    const svc = created.filter((r) => r.type === "gcp:cloudrunv2/service:Service");
    expect(svc.length).toBe(5);
  });

  it("workers service is internal-only ingress", () => {
    const workers = created.find(
      (r) => r.type === "gcp:cloudrunv2/service:Service" && r.name === "workers",
    );
    expect(workers?.inputs.ingress).toBe("INGRESS_TRAFFIC_INTERNAL_ONLY");
  });

  it("never grants allUsers invoker to workers", () => {
    const invokers = created.filter(
      (r) => r.type === "gcp:cloudrunv2/serviceIamMember:ServiceIamMember",
    );
    expect(invokers.some((r) => r.name === "workers-public")).toBe(false);
    expect(invokers.some((r) => r.name === "dashboard-public")).toBe(true);
  });

  it("creates the migrate job", () => {
    expect(created.some((r) => r.type === "gcp:cloudrunv2/job:Job")).toBe(true);
  });

  it("creates no GlobalForwardingRule in sandbox (LB off)", () => {
    expect(created.some((r) => r.type.includes("GlobalForwardingRule"))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test**

Run: `cd infra/gcp/apps && pnpm vitest run apps.mock.test.ts`
Expected: PASS. If StackReference outputs resolve as `undefined` under mocks and break evaluation, add a `call` mock branch returning fixed values for the specific output names (`projectId`, `regionOut`, `vpcConnectorId`, `artifactRegistryRepo`, `dbConnectionName`, `uploadsBucketName`, `pubsubTopicName`, `redisHost`, `redisPort`, `databaseUrlSecretName`, `secretIds`), then re-run.

- [ ] **Step 3: Commit**

```bash
git add infra/gcp/apps/apps.mock.test.ts
git commit -m "test(infra): pulumi mock test for apps layer"
```

## Self-Review checklist (run after completing tasks)

- `service-config.ts` env/IAM derivation matches the shared manifest + `planAppIam` (no inline duplication of the app list remains).
- Workers never get `allUsers`; every service runs as its own SA; secret accessors are scoped per secret.
- LB block only fires on non-sandbox + `enableHttpsLb`; sandbox mock test confirms no `GlobalForwardingRule`.
- All exports in the layer contract are present.

## Verification

- `cd infra/gcp/apps && npx tsc --noEmit`
- `cd infra/gcp/apps && pnpm vitest run`
- `pulumi preview -s sandbox` with the shared policy pack once the upstream layers exist.
