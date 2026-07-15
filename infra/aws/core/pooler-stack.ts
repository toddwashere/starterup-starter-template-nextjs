import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";
import { buildPoolerTls, buildPoolerTlsRenewal } from "./pooler-tls";
import { buildPgBouncer } from "./pgbouncer";
import { buildPoolerDatabaseUrl } from "./pooler-endpoint";
import type { AwsPoolerConfig } from "../../shared/aws-pooler-config";

export interface PoolerStackArgs {
  namePrefix: string;
  region: string;
  accountId: pulumi.Input<string>;
  poolerConfig: AwsPoolerConfig;
  hostedZone: Awaited<ReturnType<typeof aws.route53.getZone>>;
  alertTopic: Awaited<ReturnType<typeof aws.sns.getTopic>>;
  vpcId: pulumi.Input<string>;
  publicSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  privateSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  dbSecurityGroupId: pulumi.Input<string>;
  dbHost: pulumi.Input<string>;
  dbName: string;
  dbUsername: string;
  dbPassword: pulumi.Output<string>;
  dbSecretArn: pulumi.Input<string>;
  pooler: { poolSize: number; publicListener: boolean };
  cmekKeyArn?: pulumi.Input<string>;
  isProduction: boolean;
  tags?: Record<string, string>;
}

export interface PoolerStackResult {
  poolerHostname: string;
  poolerCertificateArn: pulumi.Output<string>;
  poolerTlsAlarmName: pulumi.Output<string>;
  poolerEndpointOutput: string;
  vercelDatabaseUrlSecretArn: pulumi.Output<string>;
}

/**
 * Build the complete pooler stack: TLS foundation, PgBouncer service, Route 53 alias,
 * TLS renewal wiring, and Vercel DATABASE_URL secret.
 *
 * This orchestration function ensures correct dependency order:
 * 1. TLS foundation (certificate, validation, export Lambda, initial invocation)
 * 2. PgBouncer ECS service (depends on initial TLS export)
 * 3. TLS renewal wiring (depends on service existing)
 * 4. Route 53 alias (points custom hostname to NLB)
 * 5. Vercel DATABASE_URL secret (uses custom hostname, not NLB DNS)
 */
export function buildPoolerStack(args: PoolerStackArgs): PoolerStackResult {
  const {
    namePrefix,
    region,
    accountId,
    poolerConfig,
    hostedZone,
    alertTopic,
    vpcId,
    publicSubnetIds,
    privateSubnetIds,
    dbSecurityGroupId,
    dbHost,
    dbName,
    dbUsername,
    dbPassword,
    dbSecretArn,
    pooler,
    cmekKeyArn,
    isProduction,
    tags,
  } = args;

  // Deterministic names for the ECS cluster and service
  const poolerClusterName = `${namePrefix}-pgbouncer`;
  const poolerServiceName = `${namePrefix}-pgbouncer`;

  // --- 1. TLS Foundation (certificate, validation, export, initial invocation) -----
  const tlsFoundation = buildPoolerTls({
    namePrefix,
    region,
    accountId,
    hostname: poolerConfig.hostname,
    hostedZoneId: hostedZone.zoneId,
    alertTopicArn: alertTopic.arn,
    clusterName: poolerClusterName,
    serviceName: poolerServiceName,
    isProduction,
    tags,
  });

  // --- 2. PgBouncer ECS service (depends on initial TLS export) --------------------
  const pgbouncer = buildPgBouncer({
    namePrefix,
    region,
    vpcId,
    publicSubnetIds,
    privateSubnetIds,
    dbSecurityGroupId,
    dbHost,
    dbName,
    dbSecretArn,
    pooler,
    cmekKeyArn,
    allowedCidrs: poolerConfig.allowedCidrs,
    tlsSecretArn: tlsFoundation.tlsSecretArn,
    tlsKmsKeyArn: tlsFoundation.tlsKmsKeyArn,
    initialTlsExport: tlsFoundation.initialExport,
    tags,
  });

  // --- 3. TLS renewal wiring (depends on service) ----------------------------------
  buildPoolerTlsRenewal({
    region,
    accountId,
    certificateArn: tlsFoundation.certificateArn,
    tlsSecretId: tlsFoundation.tlsSecretId,
    exporterFunction: tlsFoundation.exporterFunction,
    alertTopicArn: alertTopic.arn,
    clusterName: poolerClusterName,
    serviceName: poolerServiceName,
    service: pgbouncer.service,
  });

  // --- 4. Route 53 alias (points custom hostname to NLB) --------------------------
  new aws.route53.Record(
    "pooler-alias",
    {
      zoneId: hostedZone.zoneId,
      name: poolerConfig.hostname,
      type: "A",
      aliases: [
        {
          name: pgbouncer.loadBalancerDnsName,
          zoneId: pgbouncer.loadBalancerZoneId,
          evaluateTargetHealth: true,
        },
      ],
    },
    { dependsOn: [pgbouncer.service] },
  );

  // --- 5. Vercel DATABASE_URL secret (uses custom hostname, not NLB DNS) ----------
  const vercelPooledUrl = pulumi
    .all([dbUsername, dbPassword, dbName])
    .apply(([username, password, database]) => {
      return buildPoolerDatabaseUrl({
        username,
        password,
        hostname: poolerConfig.hostname,
        database,
      });
    });

  const vercelDbUrlSecret = new aws.secretsmanager.Secret("vercel-database-url", {
    name: `/starter/${pulumi.getStack()}/vercel-database-url`,
    recoveryWindowInDays: isProduction ? 7 : 0,
    kmsKeyId: cmekKeyArn,
    tags,
  });

  new aws.secretsmanager.SecretVersion("vercel-database-url-v1", {
    secretId: vercelDbUrlSecret.id,
    secretString: pulumi.secret(vercelPooledUrl),
  });

  return {
    poolerHostname: poolerConfig.hostname,
    poolerCertificateArn: tlsFoundation.certificateArn,
    poolerTlsAlarmName: tlsFoundation.alarmName,
    poolerEndpointOutput: poolerConfig.hostname,
    vercelDatabaseUrlSecretArn: vercelDbUrlSecret.arn,
  };
}
