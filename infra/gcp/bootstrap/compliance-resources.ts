import * as pulumi from "@pulumi/pulumi";
import * as gcp from "@pulumi/gcp";
import type { ComplianceConfig } from "../../shared/compliance";

/** Pure: locked-retention seconds for the immutable log bucket. */
export function retentionSeconds(days: number): number {
  return Math.max(0, Math.floor(days)) * 86400;
}

export interface ComplianceResourcesArgs {
  project: string;
  region: string;
  compliance: ComplianceConfig;
  /** Email for Essential Contacts (config key `securityContactEmail`). */
  securityContactEmail?: string;
  /** Resources gate their dependsOn on the enabled-APIs barrier. */
  dependsOn?: pulumi.Resource[];
}

export interface ComplianceResourcesResult {
  /** CryptoKey resource id, or "" when CMEK is disabled. */
  kmsCryptoKeyId: pulumi.Output<string>;
  /** Immutable log-sink bucket name, or "" when disabled. */
  logSinkBucketName: pulumi.Output<string>;
}

/**
 * Creates the project-wide compliance bundle. No-op when every flag is false
 * (complianceMode "none"): returns empty outputs and registers no resources.
 */
export function buildComplianceResources(
  args: ComplianceResourcesArgs,
): ComplianceResourcesResult {
  const { project, region, compliance, securityContactEmail, dependsOn } = args;

  // --- (a) Data Access audit logs (project-wide DATA_READ + DATA_WRITE). ------
  if (compliance.auditLogs) {
    new gcp.projects.IAMAuditConfig(
      "compliance-audit-config",
      {
        project,
        service: "allServices",
        auditLogConfigs: [
          { logType: "DATA_READ" },
          { logType: "DATA_WRITE" },
          { logType: "ADMIN_READ" },
        ],
      },
      { dependsOn },
    );
  }

  // --- (b) Immutable, bucket-locked log sink. --------------------------------
  let logSinkBucketName: pulumi.Output<string> = pulumi.output("");
  if (compliance.immutableLogSink) {
    const logBucket = new gcp.storage.Bucket(
      "compliance-log-sink",
      {
        name: pulumi.interpolate`${project}-compliance-logs-${pulumi.getStack()}`,
        project,
        location: region,
        uniformBucketLevelAccess: true,
        publicAccessPrevention: "enforced",
        versioning: { enabled: true },
        // Bucket Lock: immutable, irreversible retention.
        retentionPolicy: {
          isLocked: true,
          retentionPeriod: retentionSeconds(compliance.logRetentionDays),
        },
      },
      { protect: true, dependsOn },
    );
    logSinkBucketName = logBucket.name;

    // ProjectSink with a dedicated writer identity → the log bucket.
    const sink = new gcp.logging.ProjectSink(
      "compliance-log-sink-router",
      {
        project,
        name: pulumi.interpolate`compliance-sink-${pulumi.getStack()}`,
        destination: pulumi.interpolate`storage.googleapis.com/${logBucket.name}`,
        uniqueWriterIdentity: true,
      },
      { dependsOn },
    );

    // Grant the sink's writer identity objectCreator on the bucket.
    new gcp.storage.BucketIAMMember("compliance-log-sink-writer", {
      bucket: logBucket.name,
      role: "roles/storage.objectCreator",
      member: sink.writerIdentity,
    });
  }

  // --- (c) CMEK: KMS keyring + rotating crypto key. --------------------------
  let kmsCryptoKeyId: pulumi.Output<string> = pulumi.output("");
  if (compliance.cmek) {
    const keyRing = new gcp.kms.KeyRing(
      "compliance-keyring",
      {
        project,
        name: pulumi.interpolate`starter-compliance-${pulumi.getStack()}`,
        location: region,
      },
      { protect: true, dependsOn },
    );

    const cryptoKey = new gcp.kms.CryptoKey(
      "compliance-key",
      {
        name: "starter-cmek",
        keyRing: keyRing.id,
        // 90-day rotation.
        rotationPeriod: "7776000s",
        purpose: "ENCRYPT_DECRYPT",
      },
      { protect: true },
    );
    kmsCryptoKeyId = cryptoKey.id;
  }

  // --- (d) Org-policy constraints (project-scoped). --------------------------
  if (compliance.orgPolicies) {
    const parent = `projects/${project}`;

    new gcp.orgpolicy.Policy(
      "op-restrict-public-ip",
      {
        name: `${parent}/policies/sql.restrictPublicIp`,
        parent,
        spec: { rules: [{ enforce: "TRUE" }] },
      },
      { dependsOn },
    );

    new gcp.orgpolicy.Policy(
      "op-public-access-prevention",
      {
        name: `${parent}/policies/storage.publicAccessPrevention`,
        parent,
        spec: { rules: [{ enforce: "TRUE" }] },
      },
      { dependsOn },
    );

    new gcp.orgpolicy.Policy(
      "op-allowed-policy-member-domains",
      {
        name: `${parent}/policies/iam.allowedPolicyMemberDomains`,
        parent,
        // List constraint: tighten to your org's customer IDs. Default: allow all
        // until the org admin supplies allowed values, to avoid a self-lockout.
        spec: { rules: [{ allowAll: "TRUE" }] },
      },
      { dependsOn },
    );

    new gcp.orgpolicy.Policy(
      "op-resource-locations",
      {
        name: `${parent}/policies/gcp.resourceLocations`,
        parent,
        spec: {
          rules: [
            { values: { allowedValues: [`in:${region}-locations`] } },
          ],
        },
      },
      { dependsOn },
    );
  }

  // --- (e) Essential Contacts (security category). ---------------------------
  if (compliance.mode !== "none" && securityContactEmail) {
    new gcp.essentialcontacts.Contact(
      "compliance-security-contact",
      {
        parent: `projects/${project}`,
        email: securityContactEmail,
        languageTag: "en-US",
        notificationCategorySubscriptions: ["SECURITY", "TECHNICAL"],
      },
      { dependsOn },
    );
  }

  // --- (f) Binary Authorization project policy. ------------------------------
  if (compliance.binaryAuthorization) {
    new gcp.binaryauthorization.Policy(
      "compliance-binauthz-policy",
      {
        project,
        defaultAdmissionRule: {
          evaluationMode: "REQUIRE_ATTESTATION",
          enforcementMode: "ENFORCED_BLOCK_AND_AUDIT_LOG",
          requireAttestationsBies: [],
        },
        // Allow Google-managed system images so the platform keeps working.
        admissionWhitelistPatterns: [
          { namePattern: "gcr.io/google_containers/*" },
          { namePattern: "gke.gcr.io/*" },
        ],
      },
      { dependsOn },
    );
  }

  return { kmsCryptoKeyId, logSinkBucketName };
}
