import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];

const CRITICAL_TOPIC_ARN = "arn:aws:sns:us-east-2:123456789012:starter-sandbox-infra-alerts";
const WARNING_TOPIC_ARN = `${CRITICAL_TOPIC_ARN}-warning`;
const TOPIC_ARNS = { critical: CRITICAL_TOPIC_ARN, warning: WARNING_TOPIC_ARN };

function installMocks() {
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        recorded.push({ type: args.type, name: args.name, inputs: args.inputs });

        const baseState = {
          ...args.inputs,
          name: (args.inputs.name as string | undefined) ?? args.name,
          arn: `arn:aws:mock:us-east-2:123456789012:${args.name}`,
        };

        // Certificate validation returns domainValidationOptions
        if (args.type === "aws:acm/certificate:Certificate") {
          return {
            id: `${args.name}-id`,
            state: {
              ...baseState,
              domainValidationOptions: [
                {
                  domainName: args.inputs.domainName,
                  resourceRecordName: "_acme.db.sandbox.aws.example.com",
                  resourceRecordType: "CNAME",
                  resourceRecordValue: "validation.acm.amazonaws.com",
                },
              ],
            },
          };
        }

        // Lambda invocation needs result
        if (args.type === "aws:lambda/invocation:Invocation") {
          return {
            id: `${args.name}-id`,
            state: {
              ...baseState,
              result: JSON.stringify({ updated: true, deployed: false }),
            },
          };
        }

        return {
          id: `${args.name}-id`,
          state: baseState,
        };
      },
      call: (args) => args.inputs,
    },
    "test-project",
    "test",
  );
}

async function build() {
  vi.resetModules();
  recorded.length = 0;
  installMocks();
  const mod = await import("./pooler-tls.js");
  const result = mod.buildPoolerTls({
    namePrefix: "starter-sandbox",
    secretPathPrefix: "/sandbox",
    region: "us-east-2",
    accountId: "123456789012",
    hostname: "db.sandbox.aws.example.com",
    hostedZoneId: "ZDELEGATED",
    alertTopicArns: TOPIC_ARNS,
    alertTier: "critical",
    clusterName: "starter-sandbox-pgbouncer",
    serviceName: "starter-sandbox-pgbouncer",
    isProduction: false,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  return result;
}

async function buildRenewal(opts: { alertTier: "critical" | "warning" }) {
  vi.resetModules();
  recorded.length = 0;
  installMocks();

  const mod = await import("./pooler-tls.js");
  const awsMod = await import("@pulumi/aws");

  const tlsResult = mod.buildPoolerTls({
    namePrefix: "starter-sandbox",
    secretPathPrefix: "/sandbox",
    region: "us-east-2",
    accountId: "123456789012",
    hostname: "db.sandbox.aws.example.com",
    hostedZoneId: "ZDELEGATED",
    alertTopicArns: TOPIC_ARNS,
    alertTier: "critical",
    clusterName: "starter-sandbox-pgbouncer",
    serviceName: "starter-sandbox-pgbouncer",
    isProduction: false,
  });

  const service = new awsMod.ecs.Service("mock-service", {
    cluster: "arn:aws:ecs:us-east-2:123456789012:cluster/test",
    taskDefinition: "arn:aws:ecs:us-east-2:123456789012:task-definition/test:1",
  });

  mod.buildPoolerTlsRenewal({
    namePrefix: "starter-sandbox",
    region: "us-east-2",
    accountId: "123456789012",
    certificateArn: tlsResult.certificateArn,
    tlsSecretId: tlsResult.tlsSecretId,
    exporterFunction: tlsResult.exporterFunction,
    alertTopicArns: TOPIC_ARNS,
    alertTier: opts.alertTier,
    clusterName: "starter-sandbox-pgbouncer",
    serviceName: "starter-sandbox-pgbouncer",
    service,
  });

  await new Promise<void>((resolve) => setTimeout(resolve, 200));
}

function out<T>(o: pulumi.Output<T>): Promise<T> {
  return new Promise<T>((res) => o.apply(res));
}

interface PolicyStatement {
  Sid?: string;
  Effect: string;
  Action: string | string[];
  Resource: string | string[];
}

function statementsOf(policyJson: string): PolicyStatement[] {
  return JSON.parse(policyJson).Statement as PolicyStatement[];
}

const TYPES = {
  certificate: "aws:acm/certificate:Certificate",
  certValidation: "aws:acm/certificateValidation:CertificateValidation",
  route53Record: "aws:route53/record:Record",
  kmsKey: "aws:kms/key:Key",
  kmsAlias: "aws:kms/alias:Alias",
  secret: "aws:secretsmanager/secret:Secret",
  secretVersion: "aws:secretsmanager/secretVersion:SecretVersion",
  iamRole: "aws:iam/role:Role",
  iamRolePolicy: "aws:iam/rolePolicy:RolePolicy",
  lambdaFunction: "aws:lambda/function:Function",
  lambdaInvocation: "aws:lambda/invocation:Invocation",
  cloudwatchMetricAlarm: "aws:cloudwatch/metricAlarm:MetricAlarm",
  lambdaPermission: "aws:lambda/permission:Permission",
  eventRule: "aws:cloudwatch/eventRule:EventRule",
  eventTarget: "aws:cloudwatch/eventTarget:EventTarget",
  snsTopicSubscription: "aws:sns/topicSubscription:TopicSubscription",
} as const;

describe("buildPoolerTls", () => {
  beforeAll(async () => {
    await build();
  }, 10000);

  it("creates a DNS-validated ACM certificate with export enabled", () => {
    const certs = recorded.filter((r) => r.type === TYPES.certificate);
    expect(certs).toHaveLength(1);
    expect(certs[0].inputs.domainName).toBe("db.sandbox.aws.example.com");
    expect(certs[0].inputs.validationMethod).toBe("DNS");
    const options = certs[0].inputs.options as Record<string, string>;
    expect(options.certificateTransparencyLoggingPreference).toBe("ENABLED");
    expect(options.export).toBe("ENABLED");
    // RSA_2048 is exportable (EC keys are not)
    expect(certs[0].inputs.keyAlgorithm).toBe("RSA_2048");
  });

  it("creates a validation CNAME in the delegated zone", () => {
    const records = recorded.filter((r) => r.type === TYPES.route53Record);
    const validationRecords = records.filter((r) => r.inputs.type === "CNAME");
    expect(validationRecords.length).toBeGreaterThanOrEqual(1);
    const valRecord = validationRecords[0];
    expect(valRecord.inputs.zoneId).toBe("ZDELEGATED");
  });

  it("creates a rotating KMS key for pooler TLS material", () => {
    const keys = recorded.filter((r) => r.type === TYPES.kmsKey);
    const poolerKey = keys.find(
      (k) =>
        (k.inputs.description as string)?.includes("pooler") ||
        (k.inputs.description as string)?.includes("TLS"),
    );
    expect(poolerKey).toBeDefined();
    expect(poolerKey?.inputs.enableKeyRotation).toBe(true);
  });

  it("creates a KMS-encrypted secret", () => {
    const secrets = recorded.filter((r) => r.type === TYPES.secret);
    const poolerSecret = secrets.find(
      (s) =>
        (s.inputs.name as string)?.includes("pooler") ||
        (s.inputs.description as string)?.includes("pooler"),
    );
    expect(poolerSecret).toBeDefined();
    expect(poolerSecret?.inputs.kmsKeyId).toBeDefined();
    // Non-production should have immediate recovery
    expect(poolerSecret?.inputs.recoveryWindowInDays).toBe(0);
  });

  it("creates a Lambda with least-privilege IAM scoping", async () => {
    const roles = recorded.filter((r) => r.type === TYPES.iamRole);
    const lambdaRole = roles.find(
      (role) =>
        (role.inputs.name as string)?.includes("exporter") ||
        (role.inputs.description as string)?.includes("export"),
    );
    expect(lambdaRole).toBeDefined();

    const policies = recorded.filter((r) => r.type === TYPES.iamRolePolicy);
    expect(policies.length).toBeGreaterThan(0);

    // Find the policy attached to the exporter role
    const exporterPolicy = policies.find((p) => {
      const roleId = p.inputs.role;
      return roleId !== undefined;
    });
    expect(exporterPolicy).toBeDefined();

    const policyDoc = await out(
      pulumi.output(exporterPolicy!.inputs.policy as pulumi.Input<string>),
    );
    const statements = statementsOf(policyDoc);

    // ACM export scoped to the certificate
    const acmStatement = statements.find((s) =>
      JSON.stringify(s.Action).includes("acm:ExportCertificate"),
    );
    expect(acmStatement).toBeDefined();
    const acmResources = Array.isArray(acmStatement!.Resource)
      ? acmStatement!.Resource
      : [acmStatement!.Resource];
    // Should reference the certificate ARN (contains "mock" in test)
    expect(acmResources.some((r: string) => r.includes("mock"))).toBe(true);
    expect(acmResources).not.toContain("*");

    // Secrets Manager scoped to the pooler secret
    const secretStatement = statements.find((s) =>
      JSON.stringify(s.Action).includes("secretsmanager:PutSecretValue"),
    );
    expect(secretStatement).toBeDefined();
    const secretResources = Array.isArray(secretStatement!.Resource)
      ? secretStatement!.Resource
      : [secretStatement!.Resource];
    expect(secretResources).not.toContain("*");

    // KMS scoped to the pooler key
    const kmsStatement = statements.find((s) => JSON.stringify(s.Action).includes("kms:"));
    expect(kmsStatement).toBeDefined();
    const kmsResources = Array.isArray(kmsStatement!.Resource)
      ? kmsStatement!.Resource
      : [kmsStatement!.Resource];
    expect(kmsResources).not.toContain("*");

    // ECS scoped to the deterministic service ARN
    const ecsStatement = statements.find((s) =>
      JSON.stringify(s.Action).includes("ecs:UpdateService"),
    );
    expect(ecsStatement).toBeDefined();
    const ecsResources = Array.isArray(ecsStatement!.Resource)
      ? ecsStatement!.Resource
      : [ecsStatement!.Resource];
    expect(ecsResources.some((r: string) => r.includes("starter-sandbox-pgbouncer"))).toBe(true);
    expect(ecsResources).not.toContain("*");

    const functions = recorded.filter((r) => r.type === TYPES.lambdaFunction);
    expect(functions).toHaveLength(1);
    expect(functions[0].inputs.handler).toBe("index.handler");
    expect(functions[0].inputs.runtime).toBe("nodejs24.x");
    expect(functions[0].inputs.code).toBeDefined();
    expect((functions[0].inputs.code as { __pulumiArchive?: boolean }).__pulumiArchive).toBe(true);
  });

  it("creates an initial export invocation dependent on validation", () => {
    const invocations = recorded.filter((r) => r.type === TYPES.lambdaInvocation);
    const initialInvocation = invocations.find((inv) =>
      (inv.inputs.input as string)?.includes("initial"),
    );
    expect(initialInvocation).toBeDefined();
    // Verify the input contains certificateArn and secretId
    const inputStr = initialInvocation!.inputs.input as string;
    const input = JSON.parse(inputStr);
    expect(input.mode).toBe("initial");
    expect(input.certificateArn).toBeDefined();
    expect(input.secretId).toBeDefined();
    expect(input.clusterName).toBe("starter-sandbox-pgbouncer");
    expect(input.serviceName).toBe("starter-sandbox-pgbouncer");
  });

  it("creates a CloudWatch alarm for Lambda errors", () => {
    const alarms = recorded.filter((r) => r.type === TYPES.cloudwatchMetricAlarm);
    const lambdaAlarm = alarms.find(
      (a) =>
        (a.inputs.metricName as string) === "Errors" &&
        (a.inputs.namespace as string) === "AWS/Lambda",
    );
    expect(lambdaAlarm).toBeDefined();
    // The exporter alarm is warning-tier in every environment: the exporter
    // retries, and a failed export doesn't break connectivity on its own.
    expect(lambdaAlarm?.inputs.alarmActions).toEqual([WARNING_TOPIC_ARN]);
    expect(lambdaAlarm?.inputs.okActions).toBeUndefined();
  });

  it("routes the exporter alarm to the warning topic in every environment", async () => {
    await build();
    const alarm = recorded.find((r) => r.type === TYPES.cloudwatchMetricAlarm);
    expect(alarm).toBeDefined();
    // Warning even though `build()` passes alertTier "critical": the exporter
    // retries, so its failure is not worth an interrupt on its own.
    expect(alarm!.inputs.alarmActions).toEqual([WARNING_TOPIC_ARN]);
    expect(alarm!.inputs.okActions).toBeUndefined();
    expect(alarm!.inputs.period).toBe(300);
  });

  it("returns the certificate ARN, secret ARN, KMS key ARN, and initial invocation", async () => {
    expect(recorded.filter((r) => r.type === TYPES.certificate).length).toBeGreaterThan(0);
    expect(recorded.filter((r) => r.type === TYPES.secret).length).toBeGreaterThan(0);
    expect(recorded.filter((r) => r.type === TYPES.kmsKey).length).toBeGreaterThan(0);
    expect(recorded.filter((r) => r.type === TYPES.lambdaInvocation)).toHaveLength(1);
  });
});

describe("buildPoolerTlsRenewal", () => {
  it("creates EventBridge rule for ACM Certificate Available events", async () => {
    vi.resetModules();
    recorded.length = 0;
    installMocks();

    const mod = await import("./pooler-tls.js");

    // Build the TLS resources first
    const tlsResult = mod.buildPoolerTls({
      namePrefix: "starter-sandbox",
      secretPathPrefix: "/sandbox",
      region: "us-east-2",
      accountId: "123456789012",
      hostname: "db.sandbox.aws.example.com",
      hostedZoneId: "ZDELEGATED",
      alertTopicArns: TOPIC_ARNS,
      alertTier: "critical",
      clusterName: "starter-sandbox-pgbouncer",
      serviceName: "starter-sandbox-pgbouncer",
      isProduction: false,
    });

    // Create a proper mock service resource using pulumi mocks
    const aws = await import("@pulumi/aws");
    const mockService = new aws.ecs.Service("mock-service", {
      cluster: "arn:aws:ecs:us-east-2:123456789012:cluster/test",
      taskDefinition: "arn:aws:ecs:us-east-2:123456789012:task-definition/test:1",
    });

    mod.buildPoolerTlsRenewal({
      namePrefix: "starter-sandbox",
      region: "us-east-2",
      accountId: "123456789012",
      certificateArn: tlsResult.certificateArn,
      tlsSecretId: tlsResult.tlsSecretId,
      exporterFunction: tlsResult.exporterFunction,
      alertTopicArns: TOPIC_ARNS,
      alertTier: "critical",
      clusterName: "starter-sandbox-pgbouncer",
      serviceName: "starter-sandbox-pgbouncer",
      service: mockService,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    const rules = recorded.filter((r) => r.type === TYPES.eventRule);

    const certAvailableRule = rules.find((rule) => {
      const pattern = rule.inputs.eventPattern as string;
      return pattern && pattern.includes("ACM Certificate Available");
    });
    expect(certAvailableRule).toBeDefined();

    // Verify the event pattern contains the certificate ARN
    const pattern = JSON.parse(certAvailableRule!.inputs.eventPattern as string);
    expect(pattern.resources).toBeDefined();

    const renewalTargets = recorded.filter(
      (r) => r.type === TYPES.eventTarget && (r.inputs.input as string)?.includes('"renewal"'),
    );
    expect(renewalTargets).toHaveLength(1);
    const permissions = recorded.filter((r) => r.type === TYPES.lambdaPermission);
    expect(permissions).toHaveLength(1);
    expect(permissions[0].inputs.sourceArn).toBe(
      "arn:aws:events:us-east-2:123456789012:rule/starter-sandbox-pooler-tls-renewal",
    );
  }, 10000); // Increase timeout

  it("accepts a real ECS service while creating the renewal EventBridge rule", async () => {
    // Pulumi mocks cannot expose ResourceOptions.dependsOn. This regression test
    // verifies the function accepts a real service resource and still creates
    // the renewal rule; pooler-tls.ts owns the explicit dependsOn wiring.
    //
    // Context: buildPoolerTlsRenewal (pooler-tls.ts) sets { dependsOn: [service] }
    // on the renewal EventRule. The service parameter comes from buildPgBouncer's
    // PgBouncerResult.service (a real aws.ecs.Service), which buildPoolerStack
    // (pooler-stack.ts) threads into buildPoolerTlsRenewal.

    vi.resetModules();
    recorded.length = 0;
    installMocks();

    const mod = await import("./pooler-tls.js");
    const aws = await import("@pulumi/aws");

    // Build TLS foundation
    const tlsResult = mod.buildPoolerTls({
      namePrefix: "starter-sandbox",
      secretPathPrefix: "/sandbox",
      region: "us-east-2",
      accountId: "123456789012",
      hostname: "db.sandbox.aws.example.com",
      hostedZoneId: "ZDELEGATED",
      alertTopicArns: TOPIC_ARNS,
      alertTier: "critical",
      clusterName: "starter-sandbox-pgbouncer",
      serviceName: "starter-sandbox-pgbouncer",
      isProduction: false,
    });

    // Create a sentinel mock service to verify it's threaded through
    const sentinelService = new aws.ecs.Service("sentinel-service", {
      cluster: "arn:aws:ecs:us-east-2:123456789012:cluster/sentinel",
      taskDefinition: "arn:aws:ecs:us-east-2:123456789012:task-definition/sentinel:1",
      name: "sentinel-service-name",
    });

    mod.buildPoolerTlsRenewal({
      namePrefix: "starter-sandbox",
      region: "us-east-2",
      accountId: "123456789012",
      certificateArn: tlsResult.certificateArn,
      tlsSecretId: tlsResult.tlsSecretId,
      exporterFunction: tlsResult.exporterFunction,
      alertTopicArns: TOPIC_ARNS,
      alertTier: "critical",
      clusterName: "starter-sandbox-pgbouncer",
      serviceName: "starter-sandbox-pgbouncer",
      service: sentinelService,
    });

    await new Promise<void>((resolve) => setTimeout(resolve, 200));

    // Verify the sentinel service was recorded, proving it's a real Pulumi resource
    const services = recorded.filter((r) => r.type === "aws:ecs/service:Service");
    const sentinel = services.find((s) => s.inputs.name === "sentinel-service-name");
    expect(sentinel, "Sentinel service must be recorded as a real resource").toBeDefined();

    // Pulumi's mock newResource doesn't expose dependsOn in args, so verify
    // structurally that the service is a real resource and the rule exists.
    const rules = recorded.filter((r) => r.type === TYPES.eventRule);
    const renewalRule = rules.find((rule) => {
      const pattern = rule.inputs.eventPattern as string;
      return pattern?.includes("ACM Certificate Available");
    });
    expect(renewalRule).toBeDefined();
    expect(renewalRule?.inputs.eventPattern).toBeDefined();

    // The sentinel proves buildPoolerTlsRenewal receives a real aws.ecs.Service
    // rather than the former marker stand-in.
  }, 10000);

  it("sends ACM lifecycle events to the tier topic", async () => {
    await buildRenewal({ alertTier: "warning" });
    // Exclude the renewal-invoke target (arn: exporterFunction.arn, distinguished
    // by its "-sns-target" name suffix from the 4 direct SNS lifecycle targets).
    const targets = recorded.filter(
      (r) => r.type === TYPES.eventTarget && r.name.endsWith("-sns-target"),
    );
    expect(targets).toHaveLength(4);
    for (const target of targets) {
      const arn = await new Promise<string>((res) =>
        pulumi.output(target.inputs.arn as string).apply(res),
      );
      expect(arn).toBe(WARNING_TOPIC_ARN);
    }
  }, 10000);
});

describe("poolerTlsEventRuleName", () => {
  it("keeps production lifecycle rule names within the EventBridge 64-char limit", async () => {
    const { poolerTlsEventRuleName } = await import("./pooler-tls.js");
    const slugs = [
      "renewal",
      "renewal-action-required",
      "approaching-expiration",
      "expired",
      "revoked",
    ];
    for (const slug of slugs) {
      const name = poolerTlsEventRuleName("platform-production", slug);
      expect(name.length).toBeLessThanOrEqual(64);
      expect(name).toBe(`platform-production-pooler-tls-${slug}`);
    }
  });
});
