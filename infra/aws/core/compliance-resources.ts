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
  let logBucketArn: pulumi.Output<string> = pulumi.output("");
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
    logBucketArn = logBucket.arn;
  }

  // --- (c) CloudTrail: S3 + Secrets Manager data events. --------------------
  if (compliance.auditLogs) {
    // Fix 2: fail fast — a trail pointed at an empty bucket name is invalid.
    if (!compliance.immutableLogSink) {
      throw new Error(
        `auditLogs requires immutableLogSink to be enabled (namePrefix=${namePrefix}). ` +
          `Enable compliance.immutableLogSink or disable compliance.auditLogs.`,
      );
    }

    // Fix 1: standard CloudTrail bucket policy — the trail service principal
    // needs s3:GetBucketAcl on the bucket and s3:PutObject on /AWSLogs/*.
    // The trail must dependsOn this policy to avoid a creation race.
    const callerIdentity = pulumi.output(aws.getCallerIdentity({}));
    const trailBucketPolicy = new aws.s3.BucketPolicy(
      `${namePrefix}-compliance-trail-bucket-policy`,
      {
        bucket: logBucketName,
        policy: pulumi.all([logBucketArn, callerIdentity]).apply(
          ([bucketArn, identity]) =>
            JSON.stringify({
              Version: "2012-10-17",
              Statement: [
                {
                  Sid: "AWSCloudTrailAclCheck",
                  Effect: "Allow",
                  Principal: { Service: "cloudtrail.amazonaws.com" },
                  Action: "s3:GetBucketAcl",
                  Resource: bucketArn,
                },
                {
                  Sid: "AWSCloudTrailWrite",
                  Effect: "Allow",
                  Principal: { Service: "cloudtrail.amazonaws.com" },
                  Action: "s3:PutObject",
                  Resource: `${bucketArn}/AWSLogs/${identity.accountId}/*`,
                  Condition: {
                    StringEquals: {
                      "s3:x-amz-acl": "bucket-owner-full-control",
                    },
                  },
                },
              ],
            }),
        ),
      },
      { protect: true, dependsOn },
    );

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
      // Fix 1: dependsOn the bucket policy to avoid creation race.
      // Fix 4: protect:true matches KMS/S3 durable compliance resources.
      { protect: true, dependsOn: [...(dependsOn ?? []), trailBucketPolicy] },
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
      // Fix 4: protect:true matches KMS/S3 durable compliance resources.
      { protect: true, dependsOn },
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
      // Fix 4: protect:true matches KMS/S3 durable compliance resources.
      { protect: true, dependsOn },
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
      // Fix 4: protect:true matches KMS/S3 durable compliance resources.
      { protect: true, dependsOn },
    );
  }

  return { kmsKeyArn, logBucketName };
}
