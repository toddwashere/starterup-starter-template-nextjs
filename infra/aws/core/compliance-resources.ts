import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import type { ComplianceConfig } from "../../shared/compliance";

export interface ComplianceResourcesArgs {
  /** Short prefix used in every Pulumi logical name and AWS resource name. */
  namePrefix: string;
  /** AWS region (passed through; Pulumi provider picks it up automatically). */
  region: string;
  compliance: ComplianceConfig;
  /** Resources gate their dependsOn on an enabled-APIs barrier (optional). */
  dependsOn?: pulumi.Resource[];
}

export interface ComplianceResourcesResult {
  /** KMS key ARN, or "" when CMEK is disabled. */
  kmsKeyArn: pulumi.Output<string>;
  /** Object-lock log bucket name, or "" when disabled. */
  logBucketName: pulumi.Output<string>;
}

/**
 * Creates the project-wide AWS compliance bundle.  No-op when every flag is
 * false (complianceMode "none"): returns empty outputs, registers no resources.
 *
 * Mirror of infra/gcp/bootstrap/compliance-resources.ts — each block is
 * individually guarded behind its corresponding ComplianceConfig flag.
 */
export function buildComplianceResources(
  args: ComplianceResourcesArgs,
): ComplianceResourcesResult {
  const { namePrefix, compliance, dependsOn } = args;

  // --- (a) CMEK: KMS key (rotation enabled) + alias. -------------------------
  let kmsKeyArn: pulumi.Output<string> = pulumi.output("");
  if (compliance.cmek) {
    const key = new aws.kms.Key(
      `${namePrefix}-compliance-key`,
      {
        description: `${namePrefix} compliance CMEK key`,
        enableKeyRotation: true,
      },
      { protect: true, dependsOn },
    );

    new aws.kms.Alias(
      `${namePrefix}-compliance-key-alias`,
      {
        name: pulumi.interpolate`alias/${namePrefix}-compliance`,
        targetKeyId: key.keyId,
      },
      { protect: true },
    );

    kmsKeyArn = key.arn;
  }

  // --- (b) Immutable log sink: S3 BucketV2 with Object Lock. -----------------
  let logBucketName: pulumi.Output<string> = pulumi.output("");
  if (compliance.immutableLogSink) {
    const logBucket = new aws.s3.BucketV2(
      `${namePrefix}-compliance-logs`,
      {
        objectLockEnabled: true,
      },
      { protect: true, dependsOn },
    );

    new aws.s3.BucketObjectLockConfigurationV2(
      `${namePrefix}-compliance-logs-lock`,
      {
        bucket: logBucket.bucket,
        objectLockEnabled: "Enabled",
        rule: {
          defaultRetention: {
            mode: "COMPLIANCE",
            days: compliance.logRetentionDays,
          },
        },
      },
      { protect: true },
    );

    logBucketName = logBucket.bucket;
  }

  // --- (c) CloudTrail: S3 + Secrets Manager data events. --------------------
  if (compliance.auditLogs) {
    new aws.cloudtrail.Trail(
      `${namePrefix}-compliance-trail`,
      {
        name: pulumi.interpolate`${namePrefix}-compliance-trail`,
        s3BucketName: logBucketName,
        includeGlobalServiceEvents: true,
        isMultiRegionTrail: true,
        enableLogFileValidation: true,
        eventSelectors: [
          {
            readWriteType: "All",
            includeManagementEvents: true,
            dataResources: [
              {
                type: "AWS::S3::Object",
                values: ["arn:aws:s3"],
              },
              {
                type: "AWS::SecretsManager::Secret",
                values: ["arn:aws:secretsmanager"],
              },
            ],
          },
        ],
      },
      { dependsOn },
    );
  }

  // --- (d) WAF v2 WebACL (Cloud Armor equivalent, REGIONAL for App Runner). --
  if (compliance.cloudArmor) {
    new aws.wafv2.WebAcl(
      `${namePrefix}-compliance-waf`,
      {
        name: pulumi.interpolate`${namePrefix}-compliance-waf`,
        scope: "REGIONAL",
        defaultAction: { allow: {} },
        visibilityConfig: {
          cloudwatchMetricsEnabled: true,
          metricName: pulumi.interpolate`${namePrefix}-compliance-waf`,
          sampledRequestsEnabled: true,
        },
        rules: [],
      },
      { dependsOn },
    );
  }

  // --- (e) AWS Config managed rules (org-policy equivalent). -----------------
  if (compliance.orgPolicies) {
    new aws.cfg.Rule(
      `${namePrefix}-rds-public-check`,
      {
        name: pulumi.interpolate`${namePrefix}-rds-public-check`,
        source: {
          owner: "AWS",
          sourceIdentifier: "RDS_INSTANCE_PUBLIC_ACCESS_CHECK",
        },
      },
      { dependsOn },
    );

    new aws.cfg.Rule(
      `${namePrefix}-s3-encryption-check`,
      {
        name: pulumi.interpolate`${namePrefix}-s3-encryption-check`,
        source: {
          owner: "AWS",
          sourceIdentifier: "S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED",
        },
      },
      { dependsOn },
    );
  }

  return { kmsKeyArn, logBucketName };
}
