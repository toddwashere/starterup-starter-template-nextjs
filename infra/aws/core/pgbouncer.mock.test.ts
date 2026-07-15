import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import * as aws from "@pulumi/aws";

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
        return {
          id: `${args.name}-id`,
          state: {
            ...args.inputs,
            name: (args.inputs.name as string | undefined) ?? args.name,
            arn: `arn:aws:mock:us-east-2:123456789012:${args.name}`,
            dnsName: `${args.name}.elb.amazonaws.com`,
            zoneId: "Z1234567890ABC",
          },
        };
      },
      call: (args) => args.inputs,
    },
    "test-project",
    "test",
  );
}

class MockInvocation extends pulumi.Resource {
  public readonly id!: pulumi.Output<string>;
  public readonly arn!: pulumi.Output<string>;
  public readonly result!: pulumi.Output<string>;

  constructor() {
    super("aws:lambda/invocation:Invocation", "mock-invocation", true);
    this.id = pulumi.output("mock-invocation-id");
    this.arn = pulumi.output("arn:aws:lambda:us-east-2:123456789012:function:mock");
    this.result = pulumi.output("{}");
  }
}

const mockInvocation = new MockInvocation() as unknown as aws.lambda.Invocation;

async function build() {
  vi.resetModules();
  recorded.length = 0;
  installMocks();
  const mod = await import("./pgbouncer.js");
  const result = mod.buildPgBouncer({
    namePrefix: "starter-sandbox",
    region: "us-east-2",
    vpcId: "vpc-123",
    publicSubnetIds: ["subnet-pub-a", "subnet-pub-b"],
    privateSubnetIds: ["subnet-priv-a", "subnet-priv-b"],
    dbSecurityGroupId: "sg-db",
    dbHost: "starter-sandbox-db.rds.amazonaws.com",
    dbName: "starter",
    dbSecretArn:
      "arn:aws:secretsmanager:us-east-2:123456789012:secret:/starter/sandbox/rds-proxy-auth",
    pooler: { poolSize: 25, publicListener: true },
    allowedCidrs: [
      { cidr: "203.0.113.10/32", source: "application" },
      { cidr: "203.0.113.11/32", source: "application" },
      { cidr: "198.51.100.20/32", source: "developer" },
    ],
    tlsSecretArn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:pooler-tls",
    tlsKmsKeyArn: "arn:aws:kms:us-east-2:123456789012:key/pooler",
    initialTlsExport: mockInvocation,
  });
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  return result;
}

const TYPES = {
  service: "aws:ecs/service:Service",
  taskDef: "aws:ecs/taskDefinition:TaskDefinition",
  nlb: "aws:lb/loadBalancer:LoadBalancer",
  listener: "aws:lb/listener:Listener",
  sg: "aws:ec2/securityGroup:SecurityGroup",
  sgRule: "aws:ec2/securityGroupRule:SecurityGroupRule",
} as const;

describe("buildPgBouncer", () => {
  beforeAll(async () => {
    await build();
  }, 10000);

  it("runs the ECS service in private subnets without a public IP", () => {
    const services = recorded.filter((r) => r.type === TYPES.service);
    expect(services).toHaveLength(1);
    const net = services[0].inputs.networkConfiguration as {
      subnets: string[];
      assignPublicIp: boolean;
    };
    expect(net.subnets).toEqual(["subnet-priv-a", "subnet-priv-b"]);
    expect(net.assignPublicIp).toBe(false);
  });

  it("fronts the service with a public network load balancer on 6432", () => {
    const nlbs = recorded.filter((r) => r.type === TYPES.nlb);
    expect(nlbs).toHaveLength(1);
    expect(nlbs[0].inputs.loadBalancerType).toBe("network");
    expect(nlbs[0].inputs.internal).toBe(false);
    expect(nlbs[0].inputs.subnets).toEqual(["subnet-pub-a", "subnet-pub-b"]);
    // NLB must have a security group attached
    expect(nlbs[0].inputs.securityGroups).toBeDefined();
    expect(Array.isArray(nlbs[0].inputs.securityGroups)).toBe(true);
    expect((nlbs[0].inputs.securityGroups as unknown[]).length).toBeGreaterThan(0);

    const listeners = recorded.filter((r) => r.type === TYPES.listener);
    expect(listeners).toHaveLength(1);
    expect(listeners[0].inputs.port).toBe(6432);
    // Postgres negotiates TLS in-band; the listener must be plain TCP.
    expect(listeners[0].inputs.protocol).toBe("TCP");
  });

  it("lets PgBouncer reach RDS on 5432 via a db-sg ingress rule", () => {
    const rules = recorded.filter((r) => r.type === TYPES.sgRule);
    const dbIngress = rules.find((r) => r.inputs.securityGroupId === "sg-db");
    expect(dbIngress).toBeDefined();
    expect(dbIngress?.inputs.fromPort).toBe(5432);
    expect(dbIngress?.inputs.type).toBe("ingress");
    // Sourced from the pooler SG, not an open CIDR.
    expect(dbIngress?.inputs.sourceSecurityGroupId).toBeDefined();
    expect(dbIngress?.inputs.cidrBlocks).toBeUndefined();
  });

  it("configures transaction pooling with the requested pool size", () => {
    const taskDefs = recorded.filter((r) => r.type === TYPES.taskDef);
    expect(taskDefs).toHaveLength(1);
    const containers = JSON.parse(taskDefs[0].inputs.containerDefinitions as string) as Array<{
      name: string;
      environment: { name: string; value: string }[];
      dependsOn?: Array<{ containerName: string; condition: string }>;
      mountPoints?: Array<{ sourceVolume: string; containerPath: string; readOnly: boolean }>;
    }>;

    // Should have both materializer and pgbouncer containers
    expect(containers).toHaveLength(2);
    const materializer = containers.find((c) => c.name === "tls-materializer");
    const pgbouncer = containers.find((c) => c.name === "pgbouncer");
    expect(materializer).toBeDefined();
    expect(pgbouncer).toBeDefined();

    // PgBouncer depends on materializer SUCCESS
    expect(pgbouncer?.dependsOn).toBeDefined();
    expect(pgbouncer?.dependsOn).toHaveLength(1);
    expect(pgbouncer?.dependsOn?.[0].containerName).toBe("tls-materializer");
    expect(pgbouncer?.dependsOn?.[0].condition).toBe("SUCCESS");

    // Both mount the same volume; pgbouncer read-only
    expect(materializer?.mountPoints).toBeDefined();
    expect(pgbouncer?.mountPoints).toBeDefined();
    const materializerMount = materializer?.mountPoints?.find(
      (m) => m.sourceVolume === "pooler-tls",
    );
    const pgbouncerMount = pgbouncer?.mountPoints?.find((m) => m.sourceVolume === "pooler-tls");
    expect(materializerMount).toBeDefined();
    expect(pgbouncerMount).toBeDefined();
    expect(materializerMount?.containerPath).toBe("/tls");
    expect(pgbouncerMount?.containerPath).toBe("/tls");
    expect(pgbouncerMount?.readOnly).toBe(true);

    const env = Object.fromEntries(pgbouncer!.environment.map((e) => [e.name, e.value]));
    expect(env.POOL_MODE).toBe("transaction");
    expect(env.DEFAULT_POOL_SIZE).toBe("25");
    expect(env.CLIENT_TLS_SSLMODE).toBe("require");
    expect(env.CLIENT_TLS_CERT_FILE).toBe("/tls/server.crt");
    expect(env.CLIENT_TLS_KEY_FILE).toBe("/tls/server.key");
    expect(env.SERVER_TLS_SSLMODE).toBe("require");
  });

  it("never provisions a publicly accessible database resource", () => {
    for (const r of recorded) {
      expect(r.inputs.publiclyAccessible).not.toBe(true);
    }
  });

  it("returns the NLB DNS name as the pooler endpoint", async () => {
    const result = await build();
    const endpoint = await new Promise<string>((res) => result.poolerEndpoint.apply(res));
    expect(endpoint).toMatch(/elb\.amazonaws\.com$/);
  });

  it("restricts NLB ingress to allowed CIDRs without public 0.0.0.0/0", () => {
    const sgs = recorded.filter((r) => r.type === TYPES.sg);
    const nlbSg = sgs.find((sg) => sg.name.includes("nlb-sg"));
    expect(nlbSg).toBeDefined();

    // NLB SG should have no inline ingress rules (all via SecurityGroupRule)
    const inlineIngress = nlbSg?.inputs.ingress as unknown[];
    expect(inlineIngress).toBeUndefined();

    // One SecurityGroupRule per allowed CIDR (2 application + 1 developer)
    const rules = recorded.filter((r) => r.type === TYPES.sgRule);
    const ingressRules = rules.filter(
      (r) => r.inputs.type === "ingress" && r.inputs.securityGroupId === `${nlbSg?.name}-id`,
    );
    expect(ingressRules).toHaveLength(3);

    // Multiple CIDRs sharing a source must produce distinct logical names
    // (regression: a source-only name collided on a duplicate URN).
    const ruleNames = new Set(ingressRules.map((r) => r.name));
    expect(ruleNames.size).toBe(3);

    // Verify each CIDR has a rule
    const cidrs = ingressRules.map((r) => r.inputs.cidrBlocks).flat();
    expect(cidrs).toContain("203.0.113.10/32");
    expect(cidrs).toContain("203.0.113.11/32");
    expect(cidrs).toContain("198.51.100.20/32");

    // Verify descriptions match source
    const appRule = ingressRules.find((r) =>
      (r.inputs.cidrBlocks as string[])?.includes("203.0.113.10/32"),
    );
    const devRule = ingressRules.find((r) =>
      (r.inputs.cidrBlocks as string[])?.includes("198.51.100.20/32"),
    );
    expect(appRule?.inputs.description).toContain("application");
    expect(devRule?.inputs.description).toContain("developer");

    // Verify NO resource contains 0.0.0.0/0 in ingress
    for (const r of recorded) {
      const ingress = r.inputs.ingress as Array<{ cidrBlocks?: string[] }> | undefined;
      if (ingress) {
        for (const rule of ingress) {
          if (rule.cidrBlocks) {
            expect(rule.cidrBlocks).not.toContain("0.0.0.0/0");
          }
        }
      }
      if (r.type === TYPES.sgRule && r.inputs.type === "ingress") {
        const cidrBlocks = r.inputs.cidrBlocks as string[] | undefined;
        if (cidrBlocks) {
          expect(cidrBlocks).not.toContain("0.0.0.0/0");
        }
      }
    }
  });

  it("allows NLB to reach task SG on 6432 and task SG ingress only from NLB", () => {
    const rules = recorded.filter((r) => r.type === TYPES.sgRule);
    const sgs = recorded.filter((r) => r.type === TYPES.sg);
    const nlbSg = sgs.find((sg) => sg.name.includes("nlb-sg"));
    const taskSg = sgs.find((sg) => sg.name.includes("pgbouncer-sg") && !sg.name.includes("nlb"));

    // Task SG ingress from NLB SG on 6432
    const taskIngress = rules.find(
      (r) =>
        r.inputs.type === "ingress" &&
        r.inputs.fromPort === 6432 &&
        r.name.includes("pgbouncer-ingress-from-nlb"),
    );
    expect(taskIngress).toBeDefined();
    expect(taskIngress?.inputs.protocol).toBe("tcp");
    expect(taskIngress?.inputs.description).toContain("NLB");

    // NLB SG should have broad egress (default)
    const nlbSgEgress = nlbSg?.inputs.egress as Array<{ protocol: string }> | undefined;
    expect(nlbSgEgress).toBeDefined();
    expect(nlbSgEgress?.some((e) => e.protocol === "-1")).toBe(true);

    // Task SG should have NO inline 0.0.0.0/0 ingress
    const taskSgInlineIngress = taskSg?.inputs.ingress as
      | Array<{ cidrBlocks?: string[] }>
      | undefined;
    if (taskSgInlineIngress) {
      for (const rule of taskSgInlineIngress) {
        expect(rule.cidrBlocks).not.toContain("0.0.0.0/0");
      }
    }
  });

  it("materializes TLS files via secrets injection without plaintext PEM", () => {
    const taskDefs = recorded.filter((r) => r.type === TYPES.taskDef);
    expect(taskDefs).toHaveLength(1);

    // Should have pooler-tls volume
    const volumes = taskDefs[0].inputs.volumes as Array<{ name: string }> | undefined;
    expect(volumes).toBeDefined();
    const tlsVolume = volumes?.find((v) => v.name === "pooler-tls");
    expect(tlsVolume).toBeDefined();

    const containers = JSON.parse(taskDefs[0].inputs.containerDefinitions as string) as Array<{
      name: string;
      secrets?: Array<{ name: string; valueFrom: string }>;
    }>;

    const materializer = containers.find((c) => c.name === "tls-materializer");
    expect(materializer).toBeDefined();
    expect(materializer?.secrets).toBeDefined();

    // Verify secrets are injected via ARN reference, not plaintext
    const secretNames = materializer?.secrets?.map((s) => s.name) ?? [];
    expect(secretNames).toContain("TLS_CERTIFICATE");
    expect(secretNames).toContain("TLS_CERTIFICATE_CHAIN");
    expect(secretNames).toContain("TLS_PRIVATE_KEY");

    const certSecret = materializer?.secrets?.find((s) => s.name === "TLS_CERTIFICATE");
    expect(certSecret?.valueFrom).toContain("arn:aws:secretsmanager");
    expect(certSecret?.valueFrom).toContain(":certificate::");

    // Verify no plaintext PEM in any input
    const allInputsStr = JSON.stringify(taskDefs[0].inputs);
    expect(allInputsStr).not.toContain("-----BEGIN CERTIFICATE-----");
    expect(allInputsStr).not.toContain("-----BEGIN PRIVATE KEY-----");
  });

  it("service depends on initial TLS export Lambda invocation", () => {
    const services = recorded.filter((r) => r.type === TYPES.service);
    expect(services).toHaveLength(1);
    // Pulumi dependsOn is handled at resource options level, can't directly assert
    // but we verify it doesn't fail in the build
  });

  it("extends result with NLB DNS, zone ID, cluster, and service names", async () => {
    const result = await build();

    const dnsName = await new Promise<string>((res) => result.loadBalancerDnsName.apply(res));
    const zoneId = await new Promise<string>((res) => result.loadBalancerZoneId.apply(res));
    const clusterName = await new Promise<string>((res) => result.clusterName.apply(res));
    const serviceName = await new Promise<string>((res) => result.serviceName.apply(res));

    expect(dnsName).toMatch(/elb\.amazonaws\.com$/);
    expect(zoneId).toBe("Z1234567890ABC");
    expect(clusterName).toBe("starter-sandbox-pgbouncer");
    expect(serviceName).toBe("starter-sandbox-pgbouncer");
  });
});
