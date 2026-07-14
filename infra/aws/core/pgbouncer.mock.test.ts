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
        return {
          id: `${args.name}-id`,
          state: {
            ...args.inputs,
            name: (args.inputs.name as string | undefined) ?? args.name,
            arn: `arn:aws:mock:us-east-2:123456789012:${args.name}`,
            dnsName: `${args.name}.elb.amazonaws.com`,
          },
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
    const containers = JSON.parse(
      taskDefs[0].inputs.containerDefinitions as string,
    ) as Array<{ environment: { name: string; value: string }[] }>;
    const env = Object.fromEntries(
      containers[0].environment.map((e) => [e.name, e.value]),
    );
    expect(env.POOL_MODE).toBe("transaction");
    expect(env.DEFAULT_POOL_SIZE).toBe("25");
    expect(env.CLIENT_TLS_SSLMODE).toBe("require");
  });

  it("never provisions a publicly accessible database resource", () => {
    for (const r of recorded) {
      expect(r.inputs.publiclyAccessible).not.toBe(true);
    }
  });

  it("returns the NLB DNS name as the pooler endpoint", async () => {
    const result = await build();
    const endpoint = await new Promise<string>((res) =>
      result.poolerEndpoint.apply(res),
    );
    expect(endpoint).toMatch(/elb\.amazonaws\.com$/);
  });
});
