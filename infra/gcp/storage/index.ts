import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import { resolveCompliance, type ComplianceMode } from "../../shared/compliance";

const config = new pulumi.Config();
const gcpConfig = new pulumi.Config("gcp");
const project = gcpConfig.require("project");

const compliance = resolveCompliance(
  (config.get("complianceMode") as ComplianceMode) ?? "none",
);

// --- 1. Read foundational outputs from the bootstrap layer. -------------------
const bootstrapStackRef = config.require("bootstrapStackRef");
const bootstrap = new pulumi.StackReference(bootstrapStackRef);
const region = bootstrap.getOutput("regionOut") as pulumi.Output<string>;
// complianceModeOut is informational here: when non-"none", P8 supplies kmsKeyName.
const complianceMode = bootstrap.getOutput("complianceModeOut") as pulumi.Output<string>;
// kmsCryptoKeyId is "" when bootstrap created no key (CMEK disabled).
const kmsCryptoKeyId = bootstrap
  .getOutput("kmsCryptoKeyId")
  .apply((v) => (v as string) ?? "");

// --- 2. Per-layer config. -----------------------------------------------------
const forceDestroy = config.getBoolean("forceDestroy") ?? false;
// Note: the legacy manual kmsKeyName config is superseded by the compliance-gated
// wiring below (P8). Leave this comment as a migration note.
const stack = pulumi.getStack();
const isProtectedEnv = stack === "staging" || stack === "production";

// --- CMEK for GCS (gated). ---------------------------------------------------
let bucketEncryption: { defaultKmsKeyName: pulumi.Input<string> } | undefined;
let gcsKmsDeps: pulumi.Resource[] = [];
if (compliance.cmek) {
  // GCS service agent: service-<projectNumber>@gs-project-accounts.iam.gserviceaccount.com
  const gcsServiceAgent = gcp.storage.getProjectServiceAccountOutput({ project });
  const gcsKmsBinding = new gcp.kms.CryptoKeyIAMMember("gcs-cmek-binding", {
    cryptoKeyId: kmsCryptoKeyId,
    role: "roles/cloudkms.cryptoKeyEncrypterDecrypter",
    member: gcsServiceAgent.member, // already "serviceAccount:..."
  });
  bucketEncryption = { defaultKmsKeyName: kmsCryptoKeyId };
  gcsKmsDeps = [gcsKmsBinding];
}

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
    // CMEK: compliance-gated via bootstrap kmsCryptoKeyId (P8).
    ...(bucketEncryption ? { encryption: bucketEncryption } : {}),
  },
  { protect: isProtectedEnv, dependsOn: gcsKmsDeps },
);

// --- Exports (locked contract — see plan header). -----------------------------
export const uploadsBucketName = uploads.name;
export const uploadsBucketUrl = uploads.url;
// Re-export for downstream visibility / debugging (not part of the locked contract).
export const complianceModeOut = complianceMode;
