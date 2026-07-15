import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

export interface PgBouncerArgs {
  /** Short prefix used in every Pulumi logical name and AWS resource name. */
  namePrefix: string;
  region: string;
  vpcId: pulumi.Input<string>;
  /** Public subnets for the NLB (only used when pooler.publicListener). */
  publicSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  /** Private subnets for the PgBouncer Fargate tasks. */
  privateSubnetIds: pulumi.Input<pulumi.Input<string>[]>;
  /** RDS's db-sg — PgBouncer is granted 5432 ingress into it. */
  dbSecurityGroupId: pulumi.Input<string>;
  /** Private RDS instance host PgBouncer connects to. */
  dbHost: pulumi.Input<string>;
  dbName: string;
  /** Secret holding `{username,password}` for the backend connection. */
  dbSecretArn: pulumi.Input<string>;
  pooler: { poolSize: number; publicListener: boolean };
  /** CMEK ARN for reading the DB secret when compliance.cmek is on. */
  cmekKeyArn?: pulumi.Input<string>;
  /** CIDRs allowed to connect to the pooler. */
  allowedCidrs: Array<{ cidr: string; source: "application" | "developer" }>;
  /** TLS secret ARN holding certificate, certificateChain, and privateKey. */
  tlsSecretArn: pulumi.Input<string>;
  /** TLS KMS key ARN for decrypting the TLS secret. */
  tlsKmsKeyArn: pulumi.Input<string>;
  /** Initial Lambda invocation that exports TLS material. */
  initialTlsExport: aws.lambda.Invocation;
  tags?: Record<string, string>;
}

export interface PgBouncerResult {
  /** NLB DNS name clients connect to on port 6432. */
  poolerEndpoint: pulumi.Output<string>;
  /** PgBouncer task security group id. */
  securityGroupId: pulumi.Output<string>;
  /** NLB DNS name for Route 53 alias target. */
  loadBalancerDnsName: pulumi.Output<string>;
  /** NLB zone ID for Route 53 alias target. */
  loadBalancerZoneId: pulumi.Output<string>;
  /** ECS cluster name. */
  clusterName: pulumi.Output<string>;
  /** ECS service name. */
  serviceName: pulumi.Output<string>;
  /** ECS service resource for renewal wiring dependency. */
  service: aws.ecs.Service;
}

const PGBOUNCER_PORT = 6432;
// Pinned PgBouncer image. The entrypoint reads DB_* / POOL_MODE / TLS env vars.
const PGBOUNCER_IMAGE = "edoburu/pgbouncer:v1.23.1-p0";

/**
 * Public PgBouncer pooler in front of the private RDS instance.
 *
 * RDS Proxy cannot be made public, so Vercel's pooled path terminates at a
 * PgBouncer Fargate service (transaction mode) that runs in private subnets and
 * is fronted by a Network Load Balancer. RDS itself stays private — PgBouncer
 * is the only public database surface.
 *
 * Note on TLS: Postgres negotiates TLS via an in-band SSLRequest, so an NLB TLS
 * listener cannot terminate it. The NLB uses a plain TCP listener on 6432 and
 * PgBouncer terminates client TLS itself (CLIENT_TLS_SSLMODE=require). A
 * non-essential init container materializes the server cert/key from Secrets
 * Manager into a shared task volume before PgBouncer starts.
 */
export function buildPgBouncer(args: PgBouncerArgs): PgBouncerResult {
  const {
    namePrefix,
    vpcId,
    publicSubnetIds,
    privateSubnetIds,
    dbSecurityGroupId,
    dbHost,
    dbName,
    dbSecretArn,
    pooler,
    cmekKeyArn,
    allowedCidrs,
    tlsSecretArn,
    tlsKmsKeyArn,
    initialTlsExport,
    tags,
  } = args;

  // --- Security groups -------------------------------------------------------

  // NLB security group (restricted ingress via separate rules)
  const nlbSg = new aws.ec2.SecurityGroup(`${namePrefix}-pgbouncer-nlb-sg`, {
    vpcId,
    description: "Starter PgBouncer NLB security group",
    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
    tags: { ...tags, Name: `${namePrefix}-pgbouncer-nlb-sg` },
  });

  // One ingress rule per allowed CIDR. The logical name embeds the sanitized
  // CIDR (and source) so multiple CIDRs sharing a source do not collide on a
  // duplicate URN, and names stay stable regardless of list ordering.
  for (const allowed of allowedCidrs) {
    const cidrSlug = allowed.cidr.replace(/[./]/g, "-");
    new aws.ec2.SecurityGroupRule(`${namePrefix}-nlb-ingress-${allowed.source}-${cidrSlug}`, {
      type: "ingress",
      securityGroupId: nlbSg.id,
      fromPort: PGBOUNCER_PORT,
      toPort: PGBOUNCER_PORT,
      protocol: "tcp",
      cidrBlocks: [allowed.cidr],
      description: `PgBouncer from ${allowed.source} egress`,
    });
  }

  // PgBouncer task security group (no inline public ingress)
  const pgbouncerSg = new aws.ec2.SecurityGroup(`${namePrefix}-pgbouncer-sg`, {
    vpcId,
    description: "Starter PgBouncer pooler security group",
    egress: [{ protocol: "-1", fromPort: 0, toPort: 0, cidrBlocks: ["0.0.0.0/0"] }],
    tags: { ...tags, Name: `${namePrefix}-pgbouncer-sg` },
  });

  // Task ingress from NLB on 6432
  new aws.ec2.SecurityGroupRule(`${namePrefix}-pgbouncer-ingress-from-nlb`, {
    type: "ingress",
    securityGroupId: pgbouncerSg.id,
    fromPort: PGBOUNCER_PORT,
    toPort: PGBOUNCER_PORT,
    protocol: "tcp",
    sourceSecurityGroupId: nlbSg.id,
    description: "PgBouncer from NLB",
  });

  // PgBouncer -> RDS on 5432 (RDS stays private in db-sg)
  new aws.ec2.SecurityGroupRule(`${namePrefix}-db-ingress-from-pgbouncer`, {
    type: "ingress",
    securityGroupId: dbSecurityGroupId,
    fromPort: 5432,
    toPort: 5432,
    protocol: "tcp",
    sourceSecurityGroupId: pgbouncerSg.id,
    description: "Postgres from PgBouncer pooler",
  });

  // --- IAM: execution role (pull image, read secret) ------------------------
  const executionRole = new aws.iam.Role(`${namePrefix}-pgbouncer-exec`, {
    assumeRolePolicy: aws.iam.assumeRolePolicyForPrincipal({
      Service: "ecs-tasks.amazonaws.com",
    }),
    tags,
  });
  new aws.iam.RolePolicyAttachment(`${namePrefix}-pgbouncer-exec-attach`, {
    role: executionRole.name,
    policyArn: "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy",
  });
  new aws.iam.RolePolicy(`${namePrefix}-pgbouncer-exec-secrets`, {
    role: executionRole.id,
    policy: pulumi
      .all([
        pulumi.output(dbSecretArn),
        pulumi.output(cmekKeyArn ?? ""),
        pulumi.output(tlsSecretArn),
        pulumi.output(tlsKmsKeyArn),
      ])
      .apply(([dbSecret, cmek, tlsSecret, tlsKms]) => {
        const statements: Record<string, unknown>[] = [
          {
            Effect: "Allow",
            Action: ["secretsmanager:GetSecretValue"],
            Resource: [dbSecret, tlsSecret],
          },
        ];
        const kmsKeys = [tlsKms];
        if (cmek) {
          kmsKeys.push(cmek);
        }
        statements.push({
          Effect: "Allow",
          Action: ["kms:Decrypt"],
          Resource: kmsKeys,
        });
        return JSON.stringify({ Version: "2012-10-17", Statement: statements });
      }),
  });

  const logGroup = new aws.cloudwatch.LogGroup(`${namePrefix}-pgbouncer-logs`, {
    name: `/starter/${namePrefix}/pgbouncer`,
    retentionInDays: 30,
    tags,
  });

  // --- ECS cluster + task definition ----------------------------------------
  const cluster = new aws.ecs.Cluster(`${namePrefix}-pgbouncer-cluster`, {
    name: `${namePrefix}-pgbouncer`,
    tags,
  });

  const containerDefinitions = pulumi
    .all([
      pulumi.output(dbHost),
      pulumi.output(dbSecretArn),
      pulumi.output(tlsSecretArn),
      logGroup.name,
    ])
    .apply(([host, dbSecret, tlsSecret, logGroupName]) =>
      JSON.stringify([
        {
          name: "tls-materializer",
          image: PGBOUNCER_IMAGE,
          essential: false,
          // The image runs as postgres by default. Root is needed to initialize
          // the Fargate-managed volume; ownership is handed back to postgres
          // before the PgBouncer container reads the key.
          user: "0",
          entryPoint: ["/bin/sh", "-c"],
          command: [
            // Separate writes guarantee a newline between the leaf certificate
            // and intermediate chain regardless of ACM's PEM formatting.
            "umask 077 && " +
              'printf "%s\\n" "$TLS_CERTIFICATE" > /tls/server.crt && ' +
              'printf "%s\\n" "$TLS_CERTIFICATE_CHAIN" >> /tls/server.crt && ' +
              'printf "%s\\n" "$TLS_PRIVATE_KEY" > /tls/server.key && ' +
              "chown postgres:postgres /tls/server.crt /tls/server.key && " +
              "chmod 600 /tls/server.crt /tls/server.key && " +
              "exit 0",
          ],
          secrets: [
            { name: "TLS_CERTIFICATE", valueFrom: `${tlsSecret}:certificate::` },
            {
              name: "TLS_CERTIFICATE_CHAIN",
              valueFrom: `${tlsSecret}:certificateChain::`,
            },
            { name: "TLS_PRIVATE_KEY", valueFrom: `${tlsSecret}:privateKey::` },
          ],
          mountPoints: [{ sourceVolume: "pooler-tls", containerPath: "/tls", readOnly: false }],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroupName,
              "awslogs-region": args.region,
              "awslogs-stream-prefix": "materializer",
            },
          },
        },
        {
          name: "pgbouncer",
          image: PGBOUNCER_IMAGE,
          essential: true,
          dependsOn: [{ containerName: "tls-materializer", condition: "SUCCESS" }],
          portMappings: [{ containerPort: PGBOUNCER_PORT, protocol: "tcp" }],
          environment: [
            { name: "DB_HOST", value: host },
            { name: "DB_PORT", value: "5432" },
            { name: "DB_NAME", value: dbName },
            { name: "POOL_MODE", value: "transaction" },
            { name: "DEFAULT_POOL_SIZE", value: String(pooler.poolSize) },
            { name: "MAX_CLIENT_CONN", value: "1000" },
            { name: "AUTH_TYPE", value: "scram-sha-256" },
            { name: "CLIENT_TLS_SSLMODE", value: "require" },
            { name: "CLIENT_TLS_CERT_FILE", value: "/tls/server.crt" },
            { name: "CLIENT_TLS_KEY_FILE", value: "/tls/server.key" },
            { name: "SERVER_TLS_SSLMODE", value: "require" },
            { name: "LISTEN_PORT", value: String(PGBOUNCER_PORT) },
          ],
          secrets: [
            { name: "DB_USER", valueFrom: `${dbSecret}:username::` },
            { name: "DB_PASSWORD", valueFrom: `${dbSecret}:password::` },
          ],
          mountPoints: [{ sourceVolume: "pooler-tls", containerPath: "/tls", readOnly: true }],
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroupName,
              "awslogs-region": args.region,
              "awslogs-stream-prefix": "pgbouncer",
            },
          },
        },
      ]),
    );

  const taskDefinition = new aws.ecs.TaskDefinition(`${namePrefix}-pgbouncer-task`, {
    family: `${namePrefix}-pgbouncer`,
    cpu: "256",
    memory: "512",
    networkMode: "awsvpc",
    requiresCompatibilities: ["FARGATE"],
    executionRoleArn: executionRole.arn,
    containerDefinitions,
    volumes: [{ name: "pooler-tls" }],
    tags,
  });

  // --- Network Load Balancer (public) + target group + listener -------------
  const nlb = new aws.lb.LoadBalancer(`${namePrefix}-pgbouncer-nlb`, {
    name: `${namePrefix}-pgbouncer`,
    loadBalancerType: "network",
    internal: !pooler.publicListener,
    subnets: pooler.publicListener ? publicSubnetIds : privateSubnetIds,
    securityGroups: [nlbSg.id],
    tags,
  });

  const targetGroup = new aws.lb.TargetGroup(`${namePrefix}-pgbouncer-tg`, {
    name: `${namePrefix}-pgbouncer`,
    port: PGBOUNCER_PORT,
    protocol: "TCP",
    targetType: "ip",
    vpcId,
    healthCheck: { protocol: "TCP", port: String(PGBOUNCER_PORT) },
    tags,
  });

  const listener = new aws.lb.Listener(`${namePrefix}-pgbouncer-listener`, {
    loadBalancerArn: nlb.arn,
    port: PGBOUNCER_PORT,
    // Plain TCP — Postgres negotiates TLS in-band, so no NLB TLS termination.
    protocol: "TCP",
    defaultActions: [{ type: "forward", targetGroupArn: targetGroup.arn }],
  });

  // --- ECS service (private subnets, HA) ------------------------------------
  const service = new aws.ecs.Service(
    `${namePrefix}-pgbouncer-service`,
    {
      name: `${namePrefix}-pgbouncer`,
      cluster: cluster.arn,
      desiredCount: 2,
      launchType: "FARGATE",
      taskDefinition: taskDefinition.arn,
      networkConfiguration: {
        subnets: privateSubnetIds,
        securityGroups: [pgbouncerSg.id],
        assignPublicIp: false,
      },
      loadBalancers: [
        {
          targetGroupArn: targetGroup.arn,
          containerName: "pgbouncer",
          containerPort: PGBOUNCER_PORT,
        },
      ],
      tags,
    },
    { dependsOn: [listener, initialTlsExport] },
  );

  return {
    poolerEndpoint: nlb.dnsName,
    securityGroupId: pgbouncerSg.id,
    loadBalancerDnsName: nlb.dnsName,
    loadBalancerZoneId: nlb.zoneId,
    clusterName: cluster.name,
    serviceName: service.name,
    service,
  };
}
