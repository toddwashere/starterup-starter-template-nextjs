import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { buildSync } from "esbuild";
import { fileURLToPath } from "node:url";
import type { PoolerCertificateExportEvent } from "./pooler-certificate-export";

export function buildCertificateExporterCode(): string {
  const build = buildSync({
    absWorkingDir: fileURLToPath(new URL(".", import.meta.url)),
    entryPoints: ["pooler-certificate-export.ts"],
    bundle: true,
    charset: "utf8",
    format: "cjs",
    legalComments: "none",
    platform: "node",
    sourcemap: false,
    target: "node22",
    write: false,
  });
  const output = build.outputFiles[0];

  if (!output) {
    throw new Error("esbuild did not produce the pooler certificate exporter bundle");
  }

  return output.text;
}

function bundleCertificateExporter(): pulumi.asset.AssetArchive {
  return new pulumi.asset.AssetArchive({
    "index.js": new pulumi.asset.StringAsset(buildCertificateExporterCode()),
  });
}

export interface PoolerTlsArgs {
  namePrefix: string;
  region: string;
  accountId: pulumi.Input<string>;
  hostname: string;
  hostedZoneId: pulumi.Input<string>;
  alertTopicArn: pulumi.Input<string>;
  clusterName: string;
  serviceName: string;
  isProduction: boolean;
  tags?: Record<string, string>;
}

export interface PoolerTlsResult {
  certificateArn: pulumi.Output<string>;
  tlsSecretArn: pulumi.Output<string>;
  tlsSecretId: pulumi.Output<string>;
  tlsKmsKeyArn: pulumi.Output<string>;
  alarmName: pulumi.Output<string>;
  initialExport: aws.lambda.Invocation;
  exporterFunction: aws.lambda.Function;
}

export interface PoolerTlsRenewalArgs {
  region: string;
  accountId: pulumi.Input<string>;
  certificateArn: pulumi.Output<string>;
  tlsSecretId: pulumi.Output<string>;
  exporterFunction: aws.lambda.Function;
  alertTopicArn: pulumi.Input<string>;
  clusterName: string;
  serviceName: string;
  service: pulumi.Resource;
}

/**
 * Build ACM validation, export, renewal, and alarm resources for PgBouncer TLS.
 *
 * Creates a DNS-validated ACM certificate with export capability, validates it
 * via the delegated Route 53 zone, exports the certificate material to a
 * KMS-encrypted Secrets Manager secret, and sets up alarms and renewal automation.
 */
export function buildPoolerTls(args: PoolerTlsArgs): PoolerTlsResult {
  const {
    namePrefix,
    region,
    accountId,
    hostname,
    hostedZoneId,
    alertTopicArn,
    clusterName,
    serviceName,
    isProduction,
    tags,
  } = args;

  // --- 1. ACM Certificate with DNS validation and export enabled ---------------
  const certificate = new aws.acm.Certificate(`${namePrefix}-pooler-tls-cert`, {
    domainName: hostname,
    validationMethod: "DNS",
    keyAlgorithm: "RSA_2048",
    options: {
      certificateTransparencyLoggingPreference: "ENABLED",
      export: "ENABLED",
    },
    tags: { ...tags, Name: `${namePrefix}-pooler-tls-cert` },
  });

  // --- 2. Route 53 validation CNAME ---------------------------------------------
  const validationOption = certificate.domainValidationOptions[0];
  const validationRecord = new aws.route53.Record(`${namePrefix}-pooler-tls-validation`, {
    name: validationOption.resourceRecordName,
    type: validationOption.resourceRecordType,
    zoneId: hostedZoneId,
    records: [validationOption.resourceRecordValue],
    ttl: 60,
  });

  // --- 3. CertificateValidation -------------------------------------------------
  const certValidation = new aws.acm.CertificateValidation(
    `${namePrefix}-pooler-tls-validation-waiter`,
    {
      certificateArn: certificate.arn,
      validationRecordFqdns: [validationRecord.fqdn],
    },
  );

  // --- 4. Rotating KMS key + alias for pooler TLS material ---------------------
  const tlsKey = new aws.kms.Key(`${namePrefix}-pooler-tls-key`, {
    description: `${namePrefix} pooler TLS certificate material encryption key`,
    enableKeyRotation: true,
    tags,
  });

  new aws.kms.Alias(`${namePrefix}-pooler-tls-key-alias`, {
    name: `alias/${namePrefix}-pooler-tls`,
    targetKeyId: tlsKey.keyId,
  });

  // --- 5. KMS-encrypted Secrets Manager secret ----------------------------------
  const tlsSecret = new aws.secretsmanager.Secret(`${namePrefix}-pooler-tls-secret`, {
    name: `/starter/${pulumi.getStack()}/pooler-tls`,
    description: `Exported TLS certificate material for ${hostname} pooler`,
    kmsKeyId: tlsKey.id,
    recoveryWindowInDays: isProduction ? 7 : 0,
    tags,
  });

  // --- 6. Least-privilege Lambda execution role ---------------------------------
  const exporterRole = new aws.iam.Role(`${namePrefix}-pooler-tls-exporter`, {
    name: `${namePrefix}-pooler-tls-exporter`,
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "lambda.amazonaws.com",
    }),
    tags,
  });

  // Attach managed policy for basic Lambda execution (CloudWatch logs)
  const exporterBasicPolicy = new aws.iam.RolePolicyAttachment(
    `${namePrefix}-pooler-tls-exporter-basic`,
    {
      role: exporterRole.name,
      policyArn: "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole",
    },
  );

  // Least-privilege inline policy
  const exporterPolicy = new aws.iam.RolePolicy(`${namePrefix}-pooler-tls-exporter-policy`, {
    role: exporterRole.id,
    policy: pulumi
      .all([certificate.arn, tlsSecret.arn, tlsKey.arn, pulumi.output(accountId)])
      .apply(([certArn, secretArn, keyArn, acctId]) => {
        // Deterministic ECS service ARN
        const serviceArn = `arn:aws:ecs:${region}:${acctId}:service/${clusterName}/${serviceName}`;

        return JSON.stringify({
          Version: "2012-10-17",
          Statement: [
            {
              Sid: "ExportCertificate",
              Effect: "Allow",
              Action: ["acm:ExportCertificate"],
              Resource: certArn,
            },
            {
              Sid: "WriteSecret",
              Effect: "Allow",
              Action: ["secretsmanager:PutSecretValue"],
              Resource: secretArn,
            },
            {
              Sid: "UseKmsKey",
              Effect: "Allow",
              Action: ["kms:Decrypt", "kms:GenerateDataKey", "kms:DescribeKey"],
              Resource: keyArn,
            },
            {
              Sid: "UpdateEcsService",
              Effect: "Allow",
              Action: ["ecs:UpdateService"],
              Resource: serviceArn,
            },
          ],
        });
      }),
  });

  // --- Lambda log group with environment-appropriate retention ------------------
  const logRetentionDays = isProduction ? 400 : 30;
  const exporterLogGroup = new aws.cloudwatch.LogGroup(`${namePrefix}-pooler-tls-exporter-logs`, {
    name: `/aws/lambda/${namePrefix}-pooler-tls-exporter`,
    retentionInDays: logRetentionDays,
    tags,
  });

  // --- Deterministically bundled certificate exporter Lambda -------------------
  const exporterFunction = new aws.lambda.Function(
    `${namePrefix}-pooler-tls-exporter`,
    {
      code: bundleCertificateExporter(),
      handler: "index.handler",
      name: `${namePrefix}-pooler-tls-exporter`,
      role: exporterRole.arn,
      runtime: aws.lambda.Runtime.NodeJS22dX,
      memorySize: 256,
      timeout: 60,
      // Omit reserved concurrency: new accounts often have only 10 concurrent
      // executions, and AWS requires leaving at least 10 unreserved.
      tags,
    },
    {
      dependsOn: [exporterBasicPolicy, exporterPolicy, exporterLogGroup],
    },
  );

  // --- 7. Initial export invocation (dependent on validation) ------------------
  const initialExport = new aws.lambda.Invocation(
    `${namePrefix}-pooler-tls-initial-export`,
    {
      functionName: exporterFunction.name,
      input: pulumi.all([certificate.arn, tlsSecret.id]).apply(([certArn, secretId]) =>
        JSON.stringify({
          mode: "initial",
          certificateArn: certArn,
          secretId: secretId,
          clusterName,
          serviceName,
        } satisfies PoolerCertificateExportEvent),
      ),
    },
    { dependsOn: [certValidation] },
  );

  // --- 8. CloudWatch alarm for Lambda errors ------------------------------------
  const alarm = new aws.cloudwatch.MetricAlarm(`${namePrefix}-pooler-tls-exporter-errors`, {
    name: `${namePrefix}-pooler-tls-exporter-errors`,
    comparisonOperator: "GreaterThanThreshold",
    evaluationPeriods: 1,
    metricName: "Errors",
    namespace: "AWS/Lambda",
    period: 60,
    statistic: "Sum",
    threshold: 0,
    datapointsToAlarm: 1,
    treatMissingData: "notBreaching",
    dimensions: {
      FunctionName: exporterFunction.name,
    },
    alarmDescription: `Pooler TLS certificate exporter Lambda errors`,
    alarmActions: [alertTopicArn],
    okActions: [alertTopicArn],
    tags,
  });

  return {
    certificateArn: certificate.arn,
    tlsSecretArn: tlsSecret.arn,
    tlsSecretId: tlsSecret.id,
    tlsKmsKeyArn: tlsKey.arn,
    alarmName: alarm.name,
    initialExport,
    exporterFunction,
  };
}

/**
 * Build EventBridge renewal wiring for certificate rotation.
 *
 * Creates an EventBridge rule for ACM Certificate Available events (triggered on
 * renewal), plus direct SNS targets for other certificate lifecycle events.
 * The rule depends on the ECS service to ensure renewal doesn't trigger before
 * the service exists.
 */
export function buildPoolerTlsRenewal(args: PoolerTlsRenewalArgs): void {
  const {
    region,
    accountId,
    certificateArn,
    tlsSecretId,
    exporterFunction,
    alertTopicArn,
    clusterName,
    serviceName,
    service,
  } = args;

  // Use a deterministic logical name prefix
  // The Lambda function resource name is stable and known at authoring time
  const logicalPrefix = "pooler-tls";

  // --- EventBridge rule for ACM Certificate Available (renewal) -----------------
  const renewalRule = new aws.cloudwatch.EventRule(
    `${logicalPrefix}-renewal`,
    {
      name: pulumi.interpolate`${exporterFunction.name}-renewal`,
      description: "Trigger pooler TLS exporter on certificate renewal",
      eventPattern: pulumi.all([certificateArn]).apply(([certArn]) =>
        JSON.stringify({
          source: ["aws.acm"],
          "detail-type": ["ACM Certificate Available"],
          resources: [certArn],
        }),
      ),
    },
    { dependsOn: [service] },
  );

  // --- EventBridge target: invoke the exporter Lambda --------------------------
  // Reference the rule resource (renewalRule.name) so Pulumi orders the target
  // after the rule; deriving the name from exporterFunction would drop that edge
  // and race PutTargets ahead of the rule's creation.
  new aws.cloudwatch.EventTarget(`${logicalPrefix}-renewal-target`, {
    rule: renewalRule.name,
    arn: exporterFunction.arn,
    input: pulumi.all([certificateArn, tlsSecretId]).apply(([certArn, secretId]) => {
      return JSON.stringify({
        mode: "renewal",
        certificateArn: certArn,
        secretId,
        clusterName,
        serviceName,
      } satisfies PoolerCertificateExportEvent);
    }),
  });

  // --- Lambda permission for EventBridge to invoke the function -----------------
  new aws.lambda.Permission(`${logicalPrefix}-renewal-permission`, {
    action: "lambda:InvokeFunction",
    function: exporterFunction.name,
    principal: "events.amazonaws.com",
    sourceArn: pulumi.interpolate`arn:aws:events:${region}:${accountId}:rule/${renewalRule.name}`,
  });

  // --- Direct SNS targets for other certificate lifecycle events ----------------
  // These events notify operators but don't trigger automation:
  // - renewal-action-required: manual intervention needed
  // - approaching-expiration: warning before expiry
  // - expired: certificate has expired
  // - revoked: certificate was revoked

  const lifecycleEvents = [
    { name: "ACM Certificate Renewal Action Required", slug: "renewal-action-required" },
    { name: "ACM Certificate Approaching Expiration", slug: "approaching-expiration" },
    { name: "ACM Certificate Expired", slug: "expired" },
    { name: "ACM Certificate Revoked", slug: "revoked" },
  ];

  for (const event of lifecycleEvents) {
    const lifecycleRule = new aws.cloudwatch.EventRule(`${logicalPrefix}-${event.slug}`, {
      name: pulumi.interpolate`${exporterFunction.name}-${event.slug}`,
      description: `Alert on ${event.name}`,
      eventPattern: pulumi.all([certificateArn]).apply(([certArn]) =>
        JSON.stringify({
          source: ["aws.acm"],
          "detail-type": [event.name],
          resources: [certArn],
        }),
      ),
    });

    new aws.cloudwatch.EventTarget(`${logicalPrefix}-${event.slug}-sns-target`, {
      rule: lifecycleRule.name,
      arn: alertTopicArn,
    });
  }
}
