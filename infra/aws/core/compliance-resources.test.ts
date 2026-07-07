import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { resolveCompliance } from "../../shared/compliance";
import type { ComplianceConfig } from "../../shared/compliance";

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
            arn: `arn:aws:mock:us-east-1:123456789012:${args.name}`,
            bucket: (args.inputs.bucket as string | undefined) ?? args.name,
            keyId: `${args.name}-key-id`,
          },
        };
      },
      call: (args) => args.inputs,
    },
    "test-project",
    "test",
  );
}

async function buildWith(compliance: ComplianceConfig) {
  vi.resetModules();
  recorded.length = 0;
  installMocks();
  const mod = await import("./compliance-resources.js");
  const result = mod.buildComplianceResources({
    namePrefix: "test",
    region: "us-east-1",
    compliance,
  });
  // Yield so all microtask-queued resource registrations complete.
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  return result;
}

function out<T>(o: pulumi.Output<T>): Promise<T> {
  return new Promise<T>((res) => o.apply(res));
}

const COMPLIANCE_TYPES = {
  kmsKey: "aws:kms/key:Key",
  kmsAlias: "aws:kms/alias:Alias",
  s3Bucket: "aws:s3/bucketV2:BucketV2",
  objectLockConfig: "aws:s3/bucketObjectLockConfigurationV2:BucketObjectLockConfigurationV2",
  trail: "aws:cloudtrail/trail:Trail",
  webAcl: "aws:wafv2/webAcl:WebAcl",
  cfgRule: "aws:cfg/rule:Rule",
} as const;

describe("compliance resources (mode none)", () => {
  let result: Awaited<ReturnType<typeof buildWith>>;

  beforeAll(async () => {
    result = await buildWith(resolveCompliance("none"));
  }, 10000);

  it("creates no compliance resources", () => {
    for (const t of Object.values(COMPLIANCE_TYPES)) {
      expect(recorded.filter((r) => r.type === t)).toHaveLength(0);
    }
  });

  it("returns empty kmsKeyArn", async () => {
    expect(await out(result.kmsKeyArn)).toBe("");
  });

  it("returns empty logBucketName", async () => {
    expect(await out(result.logBucketName)).toBe("");
  });
});

describe("compliance resources (mode hipaa)", () => {
  let result: Awaited<ReturnType<typeof buildWith>>;

  beforeAll(async () => {
    result = await buildWith(resolveCompliance("hipaa"));
  }, 10000);

  it("creates a KMS key with rotation enabled", () => {
    const keys = recorded.filter((r) => r.type === COMPLIANCE_TYPES.kmsKey);
    expect(keys).toHaveLength(1);
    expect(keys[0].inputs.enableKeyRotation).toBe(true);
  });

  it("creates a KMS alias", () => {
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.kmsAlias)).toHaveLength(1);
  });

  it("returns non-empty kmsKeyArn", async () => {
    expect(await out(result.kmsKeyArn)).not.toBe("");
  });

  it("creates an S3 bucket with object-lock enabled", () => {
    const buckets = recorded.filter((r) => r.type === COMPLIANCE_TYPES.s3Bucket);
    expect(buckets).toHaveLength(1);
    expect(buckets[0].inputs.objectLockEnabled).toBe(true);
  });

  it("creates object-lock configuration with COMPLIANCE retention for 2190 days", () => {
    const lockConfigs = recorded.filter((r) => r.type === COMPLIANCE_TYPES.objectLockConfig);
    expect(lockConfigs).toHaveLength(1);
    const retention = (lockConfigs[0].inputs.rule as { defaultRetention: { mode: string; days: number } }).defaultRetention;
    expect(retention.mode).toBe("COMPLIANCE");
    expect(retention.days).toBe(2190);
  });

  it("creates a CloudTrail trail with S3 and SecretsManager data events", () => {
    const trails = recorded.filter((r) => r.type === COMPLIANCE_TYPES.trail);
    expect(trails).toHaveLength(1);
    const dataResources = (
      trails[0].inputs.eventSelectors as Array<{
        dataResources: Array<{ type: string }>;
      }>
    )[0].dataResources;
    const types = dataResources.map((dr) => dr.type);
    expect(types).toContain("AWS::S3::Object");
    expect(types).toContain("AWS::SecretsManager::Secret");
  });

  it("creates a WAF v2 WebACL with REGIONAL scope", () => {
    const webAcls = recorded.filter((r) => r.type === COMPLIANCE_TYPES.webAcl);
    expect(webAcls).toHaveLength(1);
    expect(webAcls[0].inputs.scope).toBe("REGIONAL");
  });

  it("creates AWS Config managed rules (RDS + S3 encryption)", () => {
    const rules = recorded.filter((r) => r.type === COMPLIANCE_TYPES.cfgRule);
    expect(rules.length).toBeGreaterThan(0);
    const identifiers = rules.map(
      (r) => (r.inputs.source as { sourceIdentifier: string }).sourceIdentifier,
    );
    expect(identifiers).toContain("RDS_INSTANCE_PUBLIC_ACCESS_CHECK");
    expect(identifiers).toContain("S3_BUCKET_SERVER_SIDE_ENCRYPTION_ENABLED");
  });
});
