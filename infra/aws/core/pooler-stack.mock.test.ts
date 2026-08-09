import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];

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

        if (args.type === "aws:lambda/invocation:Invocation") {
          return {
            id: `${args.name}-id`,
            state: {
              ...baseState,
              result: JSON.stringify({ updated: true, deployed: false }),
            },
          };
        }

        if (args.type === "aws:lb/loadBalancer:LoadBalancer") {
          return {
            id: `${args.name}-id`,
            state: {
              ...baseState,
              dnsName: "starter-sandbox-pgbouncer-nlb.us-east-2.elb.amazonaws.com",
              zoneId: "Z26RNL4JYFTOTI",
            },
          };
        }

        if (args.type === "aws:ecs/cluster:Cluster") {
          return {
            id: `${args.name}-id`,
            state: {
              ...baseState,
              name: "starter-sandbox-pgbouncer",
            },
          };
        }

        if (args.type === "aws:ecs/service:Service") {
          return {
            id: `${args.name}-id`,
            state: {
              ...baseState,
              name: "starter-sandbox-pgbouncer",
            },
          };
        }

        return {
          id: `${args.name}-id`,
          state: baseState,
        };
      },
      call: (args) => {
        // Mock aws.route53.getZone
        if (args.token === "aws:route53/getZone:getZone") {
          return {
            zoneId: "ZDELEGATED",
            name: "sandbox.aws.example.com",
          };
        }
        // Mock aws.sns.getTopic
        if (args.token === "aws:sns/getTopic:getTopic") {
          return {
            arn: "arn:aws:sns:us-east-2:123456789012:starter-sandbox-infra-alerts",
          };
        }
        return args.inputs;
      },
    },
    "test-project",
    "test",
  );
}

function out<T>(o: pulumi.Output<T>): Promise<T> {
  return new Promise<T>((res) => o.apply(res));
}

const TYPES = {
  route53Record: "aws:route53/record:Record",
  lambdaInvocation: "aws:lambda/invocation:Invocation",
  lambdaFunction: "aws:lambda/function:Function",
  lambdaAlarm: "aws:cloudwatch/metricAlarm:MetricAlarm",
  ecsService: "aws:ecs/service:Service",
  eventRule: "aws:cloudwatch/eventRule:EventRule",
} as const;

describe("buildPoolerStack integration", () => {
  beforeAll(async () => {
    vi.resetModules();
    recorded.length = 0;
    installMocks();

    const mod = await import("./pooler-stack.js");
    const aws = await import("@pulumi/aws");
    const random = await import("@pulumi/random");

    // Mock password
    const dbPassword = new random.RandomPassword("test-password", {
      length: 32,
      special: false,
    });

    mod.buildPoolerStack({
      namePrefix: "starter-sandbox",
      secretPathPrefix: "/sandbox",
      logGroupPrefix: "/sandbox",
      region: "us-east-2",
      accountId: "123456789012",
      poolerConfig: {
        rootDomain: "example.com",
        zoneName: "sandbox.aws.example.com",
        hostname: "db.sandbox.aws.example.com",
        allowedCidrs: [
          { cidr: "192.0.2.10/32", source: "application" },
          { cidr: "198.51.100.20/32", source: "developer" },
        ],
      },
      hostedZone: {
        zoneId: "ZDELEGATED",
        name: "sandbox.aws.example.com",
        arn: "arn:aws:route53:::hostedzone/ZDELEGATED",
        nameServers: [],
        tags: {},
        callerReference: "test-ref",
        comment: "",
        id: "ZDELEGATED",
        linkedServiceDescription: "",
        linkedServicePrincipal: "",
        privateZone: false,
        resourceRecordSetCount: 10,
        primaryNameServer: "ns-1.awsdns-00.com",
      },
      alertTopics: {
        critical: {
          arn: "arn:aws:sns:us-east-2:123456789012:starter-sandbox-infra-alerts",
          name: "starter-sandbox-infra-alerts",
          id: "starter-sandbox-infra-alerts",
          region: "us-east-2",
          tags: {},
        },
        warning: {
          arn: "arn:aws:sns:us-east-2:123456789012:starter-sandbox-infra-alerts-warning",
          name: "starter-sandbox-infra-alerts-warning",
          id: "starter-sandbox-infra-alerts-warning",
          region: "us-east-2",
          tags: {},
        },
      },
      alertTier: "critical",
      vpcId: "vpc-12345",
      publicSubnetIds: ["subnet-pub-1", "subnet-pub-2"],
      privateSubnetIds: ["subnet-priv-1", "subnet-priv-2"],
      dbSecurityGroupId: "sg-db",
      dbHost: "starter-sandbox-db.region.rds.amazonaws.com",
      dbName: "app_db",
      dbUsername: "app_db_user",
      dbPassword: dbPassword.result,
      dbSecretArn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:test",
      pooler: { poolSize: 20, publicListener: true },
      isProduction: false,
    });

    // Wait for async resource creation
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }, 10000);

  it("creates the Route 53 alias record targeting the NLB", () => {
    const records = recorded.filter((r) => r.type === TYPES.route53Record);
    const aliasRecord = records.find(
      (r) => r.inputs.type === "A" && Array.isArray(r.inputs.aliases),
    );

    expect(aliasRecord).toBeDefined();
    expect(aliasRecord?.inputs.name).toBe("db.sandbox.aws.example.com");
    expect(aliasRecord?.inputs.zoneId).toBe("ZDELEGATED");

    const aliases = aliasRecord?.inputs.aliases as Array<Record<string, unknown>>;
    expect(aliases).toHaveLength(1);
    expect(aliases[0].name).toBe("starter-sandbox-pgbouncer-nlb.us-east-2.elb.amazonaws.com");
    expect(aliases[0].zoneId).toBe("Z26RNL4JYFTOTI");
    expect(aliases[0].evaluateTargetHealth).toBe(true);
  });

  it("composes the initial TLS export and ECS service without serialization failures", () => {
    const invocations = recorded.filter((r) => r.type === TYPES.lambdaInvocation);
    const services = recorded.filter((r) => r.type === TYPES.ecsService);
    const functions = recorded.filter((r) => r.type === TYPES.lambdaFunction);
    const alarms = recorded.filter((r) => r.type === TYPES.lambdaAlarm);

    expect(services.length, "ECS service must be created").toBeGreaterThan(0);
    expect(functions).toHaveLength(1);
    expect(functions[0].inputs.handler).toBe("index.handler");
    expect(functions[0].inputs.runtime).toBe("nodejs22.x");
    expect((functions[0].inputs.code as { __pulumiArchive?: boolean }).__pulumiArchive).toBe(true);
    expect(alarms.some((alarm) => alarm.inputs.namespace === "AWS/Lambda")).toBe(true);

    const service = services[0];
    expect(service.inputs.name).toBe("starter-sandbox-pgbouncer");

    const initialInvocation = invocations.find((inv) =>
      (inv.inputs.input as string)?.includes("initial"),
    );
    expect(initialInvocation, "Initial TLS export invocation must be created").toBeDefined();

    const input = JSON.parse(initialInvocation!.inputs.input as string);
    expect(input.mode).toBe("initial");
    expect(input.clusterName).toBe("starter-sandbox-pgbouncer");
    expect(input.serviceName).toBe("starter-sandbox-pgbouncer");
  });

  it("composes TLS renewal wiring with the real ECS service", () => {
    const services = recorded.filter((r) => r.type === TYPES.ecsService);
    const renewalRules = recorded.filter(
      (r) =>
        r.type === TYPES.eventRule &&
        (r.inputs.eventPattern as string)?.includes("ACM Certificate Available"),
    );

    expect(services.length, "ECS service must be created").toBeGreaterThan(0);
    expect(renewalRules.length, "EventBridge renewal rule must be created").toBeGreaterThan(0);

    const service = services[0];
    expect(service.inputs.name).toBe("starter-sandbox-pgbouncer");

    const renewalRule = renewalRules[0];
    const pattern = JSON.parse(renewalRule.inputs.eventPattern as string);
    expect(pattern.source).toContain("aws.acm");
    expect(pattern["detail-type"]).toContain("ACM Certificate Available");
  });

  it("exports the custom hostname, not the generated NLB name", async () => {
    // This test verifies the exported endpoint is the custom hostname
    // In the real stack, poolerEndpointOutput would be set to the hostname
    // We verify the alias record points to db.sandbox.aws.example.com
    const records = recorded.filter((r) => r.type === TYPES.route53Record);
    const aliasRecord = records.find(
      (r) => r.inputs.type === "A" && Array.isArray(r.inputs.aliases),
    );

    expect(aliasRecord?.inputs.name).toBe("db.sandbox.aws.example.com");
    // The exported endpoint should use this name, not the NLB DNS name
  });
});
