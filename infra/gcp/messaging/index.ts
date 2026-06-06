import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const project = gcpConfig.require("project");
const region = gcpConfig.require("region");

// --- Read foundational outputs from the bootstrap layer. ----------------------
const bootstrapStackRef = config.require("bootstrapStackRef");
const bootstrap = new pulumi.StackReference(bootstrapStackRef);

// networkId is "" when bootstrap provisioned no private network (e.g. sandbox).
const networkId = bootstrap.getOutput("networkId").apply((v) => (v as string) ?? "");

// --- Feature flag + per-stack Redis tuning. -----------------------------------
const enableRedis = config.getBoolean("enableRedis") ?? false;
const redisTier = config.get("redisTier") ?? "BASIC";
const redisMemorySizeGb = config.getNumber("redisMemorySizeGb") ?? 1;

// --- Pub/Sub (always created — queue backend for the GCP profile). ------------
// Mirrors infra/gcp/core/index.ts exactly.
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

// --- Memorystore (Redis) — flag-gated cache. ----------------------------------
// Off = not created (GCP can't cheaply pause Redis). When a private network is
// present, attach to it via PRIVATE_SERVICE_ACCESS; otherwise create a basic
// instance with default (DIRECT_PEERING) connectivity.
const redis = enableRedis
  ? networkId.apply((net) =>
      net
        ? new gcp.redis.Instance("starter-redis", {
            name: pulumi.interpolate`starter-cache-${pulumi.getStack()}`,
            tier: redisTier,
            memorySizeGb: redisMemorySizeGb,
            region,
            authorizedNetwork: net,
            connectMode: "PRIVATE_SERVICE_ACCESS",
          })
        : new gcp.redis.Instance("starter-redis", {
            name: pulumi.interpolate`starter-cache-${pulumi.getStack()}`,
            tier: redisTier,
            memorySizeGb: redisMemorySizeGb,
            region,
          }),
    )
  : undefined;

// --- Exports (locked contract — consumed by apps/P6). -------------------------
export const pubsubTopicName = jobsTopic.name;
export const pubsubSubscriptionName = jobsSubscription.name;
export const pubsubDlqTopicName = dlqTopic.name;

// Redis disabled → empty/zero outputs (downstream tolerates the empty-output
// pattern, same as bootstrap/core network outputs).
export const redisHost: pulumi.Output<string> = redis
  ? redis.apply((r) => r.host)
  : pulumi.output("");
export const redisPort: pulumi.Output<number> = redis
  ? redis.apply((r) => r.port)
  : pulumi.output(0);

// Pin `project` to silence potential "declared but never used" under strict TS.
export const projectId = project;
