import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

type BucketState = {
  name?: string;
  uniformBucketLevelAccess?: boolean;
  publicAccessPrevention?: string;
  forceDestroy?: boolean;
  versioning?: { enabled?: boolean };
  encryption?: { defaultKmsKeyName?: string };
  url?: string;
};

const capturedBuckets: BucketState[] = [];

function installMocks(bootstrapOutputs: Record<string, string> = {}) {
  const defaultBootstrapOutputs = {
    projectId: "test-project",
    regionOut: "us-central1",
    complianceModeOut: "none",
    kmsCryptoKeyId: "",
    ...bootstrapOutputs,
  };
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        if (args.type === "gcp:storage/bucket:Bucket") {
          const state: BucketState = {
            ...args.inputs,
            name: args.inputs.name ?? args.name,
            url: `gs://${args.inputs.name ?? args.name}`,
          };
          capturedBuckets.push(state);
          return { id: `${args.name}-id`, state };
        }
        // StackReference: return the bootstrap outputs in state.
        if (args.type === "pulumi:pulumi:StackReference") {
          return {
            id: `${args.name}-id`,
            state: {
              outputs: defaultBootstrapOutputs,
            },
          };
        }
        return {
          id: `${args.name}-id`,
          state: { ...args.inputs, name: args.inputs.name ?? args.name },
        };
      },
      // StackReference outputs come back through the call handler.
      call: () => ({
        outputs: defaultBootstrapOutputs,
      }),
    },
    "starter-gcp-storage",
    "sandbox",
  );
}

async function importInfra(
  extraConfig: Record<string, string> = {},
  bootstrapOutputs: Record<string, string> = {},
) {
  vi.resetModules();
  capturedBuckets.length = 0;
  const cfg = {
    "gcp:project": "test-project",
    "gcp:region": "us-central1",
    "starter-gcp-storage:bootstrapStackRef":
      "test-org/starter-gcp-bootstrap/sandbox",
    "starter-gcp-storage:forceDestroy": "true",
    ...extraConfig,
  };
  process.env.PULUMI_CONFIG = JSON.stringify(cfg);
  installMocks(bootstrapOutputs);
  pulumi.runtime.setAllConfig(cfg);
  const mod = await import("./index");
  // Pulumi registers resources asynchronously in microtasks after the module
  // is imported. Yield to the event loop so all newResource calls complete
  // before the tests read the capturedBuckets array.
  await new Promise<void>((resolve) => setTimeout(resolve, 200));
  return mod;
}

function out<T>(o: pulumi.Output<T>): Promise<T> {
  return new Promise<T>((res) => o.apply(res));
}

describe("storage layer (mocked) — no CMEK", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    infra = await importInfra({}, {});
  }, 10000);

  afterAll(() => {
    delete process.env.PULUMI_CONFIG;
  });

  it("creates a single uploads bucket", () => {
    expect(capturedBuckets.length).toBe(1);
  });

  it("enables uniform bucket-level access", () => {
    expect(capturedBuckets[0].uniformBucketLevelAccess).toBe(true);
  });

  it("enforces public access prevention", () => {
    expect(capturedBuckets[0].publicAccessPrevention).toBe("enforced");
  });

  it("enables versioning", () => {
    expect(capturedBuckets[0].versioning?.enabled).toBe(true);
  });

  it("does not set a default KMS key when kmsKeyName is unset", () => {
    expect(capturedBuckets[0].encryption?.defaultKmsKeyName).toBeFalsy();
  });

  it("uses forceDestroy from config (true in sandbox)", () => {
    expect(capturedBuckets[0].forceDestroy).toBe(true);
  });

  it("names the bucket per project + stack", () => {
    expect(capturedBuckets[0].name).toBe("test-project-uploads-sandbox");
  });

  it("exports the bucket name and url", async () => {
    const name = await out(infra.uploadsBucketName);
    const url = await out(infra.uploadsBucketUrl);
    expect(name).toBe("test-project-uploads-sandbox");
    expect(url).toContain("test-project-uploads-sandbox");
  });
});

describe("storage layer (mocked) — with CMEK (compliance-driven)", () => {
  const kmsKeyId =
    "projects/test-project/locations/us-central1/keyRings/r/cryptoKeys/cmek";

  beforeAll(async () => {
    await importInfra(
      { "starter-gcp-storage:complianceMode": "soc2" },
      { kmsCryptoKeyId: kmsKeyId },
    );
  }, 10000);

  afterAll(() => {
    delete process.env.PULUMI_CONFIG;
  });

  it("sets the default KMS key when complianceMode enables CMEK", async () => {
    // The encryption.defaultKmsKeyName is an Output<string>; resolve it.
    const kmsName = await new Promise<string | undefined>((res) => {
      const enc = capturedBuckets[0].encryption;
      if (!enc?.defaultKmsKeyName) return res(undefined);
      (pulumi.output(enc.defaultKmsKeyName) as pulumi.Output<string>).apply(res);
    });
    expect(kmsName).toBe(kmsKeyId);
  });
});
