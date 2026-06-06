import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const project = gcpConfig.require("project");

// --- 1. Read foundational outputs from the bootstrap layer. -------------------
const bootstrapStackRef = config.require("bootstrapStackRef");
const bootstrap = new pulumi.StackReference(bootstrapStackRef);
const region = bootstrap.getOutput("regionOut") as pulumi.Output<string>;
// complianceModeOut is informational here: when non-"none", P8 supplies kmsKeyName.
const complianceMode = bootstrap.getOutput("complianceModeOut") as pulumi.Output<string>;

// --- 2. Per-layer config. -----------------------------------------------------
const forceDestroy = config.getBoolean("forceDestroy") ?? false;
// Optional CMEK key resource name. Unset in P3; supplied by P8 (compliance).
const kmsKeyName = config.get("kmsKeyName");
const stack = pulumi.getStack();
const isProtectedEnv = stack === "staging" || stack === "production";

// --- 3. uploads bucket (general object storage). ------------------------------
// Unique per project + env. Security hardening: uniform bucket-level access,
// enforced public-access prevention, versioning. forceDestroy is env-gated;
// protect: true guards the staging/prod bucket against accidental deletion.
const uploads = new gcp.storage.Bucket(
  "uploads",
  {
    name: pulumi.interpolate`${project}-uploads-${stack}`,
    project,
    location: region,
    uniformBucketLevelAccess: true,
    publicAccessPrevention: "enforced",
    forceDestroy,
    versioning: { enabled: true },
    // CMEK is opt-in: only set when P8 (compliance) supplies a key name.
    ...(kmsKeyName
      ? { encryption: { defaultKmsKeyName: kmsKeyName } }
      : {}),
  },
  { protect: isProtectedEnv },
);

// --- Exports (locked contract — see plan header). -----------------------------
export const uploadsBucketName = uploads.name;
export const uploadsBucketUrl = uploads.url;
// Re-export for downstream visibility / debugging (not part of the locked contract).
export const complianceModeOut = complianceMode;
