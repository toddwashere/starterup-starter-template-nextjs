import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { resolveCompliance, type ComplianceMode } from "../../shared/compliance";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const project = gcpConfig.require("project");
const region = gcpConfig.require("region");

const compliance = resolveCompliance((config.get("complianceMode") as ComplianceMode) ?? "none");

// --- Read foundational outputs from the bootstrap layer. ----------------------
const bootstrapStackRef = config.require("bootstrapStackRef");
const bootstrap = new pulumi.StackReference(bootstrapStackRef);

// networkId is "" when bootstrap provisioned no private network (e.g. sandbox).
const networkId = bootstrap.getOutput("networkId").apply((v) => (v as string) ?? "");
// kmsCryptoKeyId is "" when bootstrap created no key (CMEK disabled).
const kmsCryptoKeyId = bootstrap.getOutput("kmsCryptoKeyId").apply((v) => (v as string) ?? "");

// --- Feature flag + per-stack Redis tuning. -----------------------------------
const enableRedis = config.getBoolean("enableRedis") ?? false;
const redisTier = config.get("redisTier") ?? "BASIC";
const redisMemorySizeGb = config.getNumber("redisMemorySizeGb") ?? 1;

// --- CMEK for Pub/Sub (gated). -----------------------------------------------
let topicKmsKeyName: pulumi.Input<string> | undefined;
let pubsubKmsDeps: pulumi.Resource[] = [];
if (compliance.cmek) {
  const projectInfo = gcp.organizations.getProjectOutput({ projectId: project });
  // Pub/Sub service agent: service-<projectNumber>@gcp-sa-pubsub.iam.gserviceaccount.com
  const pubsubServiceAgent = projectInfo.number.apply(
    (n) => `serviceAccount:service-${n}@gcp-sa-pubsub.iam.gserviceaccount.com`,
  );
  const pubsubKmsBinding = new gcp.kms.CryptoKeyIAMMember("pubsub-cmek-binding", {
    cryptoKeyId: kmsCryptoKeyId,
    role: "roles/cloudkms.cryptoKeyEncrypterDecrypter",
    member: pubsubServiceAgent,
  });
  topicKmsKeyName = kmsCryptoKeyId;
  pubsubKmsDeps = [pubsubKmsBinding];
}

// --- Pub/Sub (always created — queue backend for the GCP profile). ------------
const jobsTopic = new gcp.pubsub.Topic(
  "jobs",
  {
    name: pulumi.interpolate`jobs-${pulumi.getStack()}`,
    kmsKeyName: topicKmsKeyName,
  },
  { dependsOn: pubsubKmsDeps },
);

const dlqTopic = new gcp.pubsub.Topic(
  "jobs-dlq",
  {
    name: pulumi.interpolate`jobs-dlq-${pulumi.getStack()}`,
    kmsKeyName: topicKmsKeyName,
  },
  { dependsOn: pubsubKmsDeps },
);

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
// networkId flows through resource INPUTS (not a resource constructed inside
// .apply) so that pulumi preview is deterministic and the dependency edge is
// visible in the resource graph.
const redis = enableRedis
  ? new gcp.redis.Instance("starter-redis", {
      name: pulumi.interpolate`platform-cache-${pulumi.getStack()}`,
      tier: redisTier,
      memorySizeGb: redisMemorySizeGb,
      region,
      // Attach to the VPC when bootstrap provides a private network; otherwise
      // GCP uses default (DIRECT_PEERING) connectivity. networkId flows through
      // resource INPUTS (not a resource constructed inside .apply).
      authorizedNetwork: networkId.apply((net) => net || ""),
      connectMode: networkId.apply((net) => (net ? "PRIVATE_SERVICE_ACCESS" : "DIRECT_PEERING")),
    })
  : undefined;

// --- Exports (locked contract — consumed by apps/P6). -------------------------
export const pubsubTopicName = jobsTopic.name;
export const pubsubSubscriptionName = jobsSubscription.name;
export const pubsubDlqTopicName = dlqTopic.name;

// Redis disabled → empty/zero outputs (downstream tolerates the empty-output
// pattern, same as bootstrap/core network outputs).
export const redisHost: pulumi.Output<string> = redis ? redis.host : pulumi.output("");
export const redisPort: pulumi.Output<number> = redis ? redis.port : pulumi.output(0);

// Pin `project` to silence potential "declared but never used" under strict TS.
export const projectId = project;
