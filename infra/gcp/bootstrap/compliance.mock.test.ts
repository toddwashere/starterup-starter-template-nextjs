import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { retentionSeconds } from "./compliance-resources";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, any>;
}

const recorded: RecordedResource[] = [];

function installMocks() {
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        recorded.push({ type: args.type, name: args.name, inputs: args.inputs });
        return {
          id: `${args.name}-id`,
          state: { ...args.inputs, name: args.inputs.name ?? args.name },
        };
      },
      call: (args) => args.inputs,
    },
    "starter-gcp-bootstrap",
    "production",
  );
}

async function importInfra(extraConfig: Record<string, string>) {
  vi.resetModules();
  recorded.length = 0;
  const cfg = {
    "gcp:project": "test-project",
    "gcp:region": "us-central1",
    ...extraConfig,
  };
  process.env.PULUMI_CONFIG = JSON.stringify(cfg);
  installMocks();
  pulumi.runtime.setAllConfig(cfg);
  const mod = await import("./index");
  // Yield so all microtask-queued resource registrations complete.
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  return mod;
}

function out<T>(o: pulumi.Output<T>): Promise<T> {
  return new Promise<T>((res) => o.apply(res));
}

const COMPLIANCE_TYPES = {
  auditConfig: "gcp:projects/iAMAuditConfig:IAMAuditConfig",
  sink: "gcp:logging/projectSink:ProjectSink",
  sinkWriter: "gcp:storage/bucketIAMMember:BucketIAMMember",
  keyRing: "gcp:kms/keyRing:KeyRing",
  cryptoKey: "gcp:kms/cryptoKey:CryptoKey",
  orgPolicy: "gcp:orgpolicy/policy:Policy",
  contact: "gcp:essentialcontacts/contact:Contact",
  binauthz: "gcp:binaryauthorization/policy:Policy",
} as const;

describe("retentionSeconds helper", () => {
  it("converts days to seconds", () => {
    expect(retentionSeconds(2190)).toBe(189216000);
    expect(retentionSeconds(365)).toBe(31536000);
    expect(retentionSeconds(0)).toBe(0);
  });
});

describe("bootstrap compliance (mode none)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    infra = await importInfra({ "starter-gcp-bootstrap:complianceMode": "none" });
  }, 10000);

  afterAll(() => {
    delete process.env.PULUMI_CONFIG;
  });

  it("creates no compliance resources", () => {
    for (const t of Object.values(COMPLIANCE_TYPES)) {
      expect(recorded.filter((r) => r.type === t)).toHaveLength(0);
    }
  });

  it("exports an empty kmsCryptoKeyId", async () => {
    expect(await out(infra.kmsCryptoKeyId)).toBe("");
  });

  it("exports an empty logSinkBucketName", async () => {
    expect(await out(infra.logSinkBucketName)).toBe("");
  });
});

describe("bootstrap compliance (mode hipaa)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    infra = await importInfra({
      "starter-gcp-bootstrap:complianceMode": "hipaa",
      "starter-gcp-bootstrap:securityContactEmail": "security@example.com",
    });
  }, 10000);

  afterAll(() => {
    delete process.env.PULUMI_CONFIG;
  });

  it("creates exactly one audit config covering DATA_READ + DATA_WRITE", () => {
    const cfgs = recorded.filter((r) => r.type === COMPLIANCE_TYPES.auditConfig);
    expect(cfgs).toHaveLength(1);
    expect(cfgs[0].inputs.service).toBe("allServices");
    const logTypes = (cfgs[0].inputs.auditLogConfigs as Array<{ logType: string }>).map(
      (c) => c.logType,
    );
    expect(logTypes).toContain("DATA_READ");
    expect(logTypes).toContain("DATA_WRITE");
  });

  it("creates a bucket-locked log sink with 2190-day retention", () => {
    const buckets = recorded.filter(
      (r) =>
        r.type === "gcp:storage/bucket:Bucket" &&
        r.inputs.retentionPolicy !== undefined,
    );
    expect(buckets).toHaveLength(1);
    expect(buckets[0].inputs.retentionPolicy.isLocked).toBe(true);
    expect(buckets[0].inputs.retentionPolicy.retentionPeriod).toBe(2190 * 86400);
  });

  it("creates the project sink + objectCreator writer binding", () => {
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.sink)).toHaveLength(1);
    const writer = recorded.filter((r) => r.type === COMPLIANCE_TYPES.sinkWriter);
    expect(writer).toHaveLength(1);
    expect(writer[0].inputs.role).toBe("roles/storage.objectCreator");
  });

  it("creates a KMS crypto key and exports a non-empty kmsCryptoKeyId", async () => {
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.cryptoKey)).toHaveLength(1);
    expect(await out(infra.kmsCryptoKeyId)).not.toBe("");
  });

  it("creates org policies, an essential contact, and a binauthz policy", () => {
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.orgPolicy).length).toBeGreaterThan(0);
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.contact)).toHaveLength(1);
    expect(recorded.filter((r) => r.type === COMPLIANCE_TYPES.binauthz)).toHaveLength(1);
  });
});
