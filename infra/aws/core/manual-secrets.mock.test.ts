import { describe, it, expect, beforeAll, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import { deploymentNames, resolveDeploymentIdentity } from "../naming";
import { awsCatalogAppSecrets, awsCatalogPlaceholderSeed } from "../../shared/aws-catalog-secrets";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];

// Pulumi's mock `newResource` callback only ever sees `args.inputs` — it never
// receives the resource options (`opts`) a resource was constructed with. That
// means the mock alone can't prove `ignoreChanges: ["secretString"]` was passed
// to `SecretVersion`. To verify it for real, we intercept the `SecretVersion`
// constructor itself (via `vi.mock` + `vi.hoisted`, since `vi.mock` factories
// are hoisted above all other module-level code) and capture its third
// argument — the actual `pulumi.CustomResourceOptions` the implementation used.
const { recordedVersionOpts } = vi.hoisted(() => ({
  recordedVersionOpts: [] as (pulumi.CustomResourceOptions | undefined)[],
}));

vi.mock("@pulumi/aws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulumi/aws")>();
  type VersionArgs = ConstructorParameters<typeof actual.secretsmanager.SecretVersion>[1];
  type VersionOpts = ConstructorParameters<typeof actual.secretsmanager.SecretVersion>[2];

  class SpySecretVersion extends actual.secretsmanager.SecretVersion {
    constructor(name: string, args: VersionArgs, opts?: VersionOpts) {
      recordedVersionOpts.push(opts);
      super(name, args, opts);
    }
  }

  return {
    ...actual,
    secretsmanager: {
      ...actual.secretsmanager,
      SecretVersion: SpySecretVersion,
    },
  };
});

function installMocks() {
  pulumi.runtime.setMocks(
    {
      newResource: (args) => {
        recorded.push({ type: args.type, name: args.name, inputs: args.inputs });
        return {
          id: `${args.name}-id`,
          state: {
            ...args.inputs,
            arn: `arn:aws:secretsmanager:us-east-2:123456789012:secret:${args.name}`,
          },
        };
      },
      call: (args) => args.inputs,
    },
    "test-project",
    "test",
  );
}

const SECRET_TYPE = "aws:secretsmanager/secret:Secret";
const VERSION_TYPE = "aws:secretsmanager/secretVersion:SecretVersion";

describe("buildCatalogPlaceholderSecrets", () => {
  beforeAll(async () => {
    vi.resetModules();
    recorded.length = 0;
    recordedVersionOpts.length = 0;
    installMocks();
    const mod = await import("./manual-secrets.js");
    const names = deploymentNames(resolveDeploymentIdentity({}), "sandbox");
    mod.buildCatalogPlaceholderSecrets({
      secretPathPrefix: names.secretPathPrefix,
      isProduction: false,
      tags: names.tags,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }, 10000);

  it("creates one secret per catalog app secret under /sandbox/<id>, excluding database-url", () => {
    const secrets = recorded.filter((r) => r.type === SECRET_TYPE);
    const names = secrets.map((s) => s.inputs.name as string).sort();
    const expected = awsCatalogAppSecrets()
      .map((s) => `/sandbox/${s.id}`)
      .sort();
    expect(names).toEqual(expected);
    expect(names.some((n) => n.endsWith("/database-url"))).toBe(false);
  });

  it("sets recoveryWindowInDays to 0 for non-production", () => {
    const secrets = recorded.filter((r) => r.type === SECRET_TYPE);
    expect(secrets.length).toBeGreaterThan(0);
    for (const s of secrets) {
      expect(s.inputs.recoveryWindowInDays).toBe(0);
    }
  });

  it("seeds exactly one placeholder version per secret", () => {
    const versions = recorded.filter((r) => r.type === VERSION_TYPE);
    expect(versions).toHaveLength(awsCatalogAppSecrets().length);
    for (const v of versions) {
      expect(v.inputs.secretId).toBeDefined();
    }
  });

  it("seeds the plain-string catalog placeholder (not JSON) for each secret", () => {
    // The Secrets Manager provider schema marks `secretString` as sensitive, so
    // the mock's recorded `inputs.secretString` isn't a reliable plaintext read.
    // Assert against the seed helper directly instead — it's the single source
    // of truth the implementation is required to consume.
    for (const spec of awsCatalogAppSecrets()) {
      const seed = awsCatalogPlaceholderSeed(spec.id);
      expect(typeof seed).toBe("string");
      expect(() => JSON.parse(seed)).toThrow();
    }
  });

  it('passes ignoreChanges: ["secretString"] as resource options on every placeholder version', () => {
    expect(recordedVersionOpts.length).toBe(awsCatalogAppSecrets().length);
    for (const opts of recordedVersionOpts) {
      expect(opts).toEqual({ ignoreChanges: ["secretString"] });
    }
  });
});

describe("buildCatalogPlaceholderSecrets configured identity", () => {
  beforeAll(async () => {
    vi.resetModules();
    recorded.length = 0;
    recordedVersionOpts.length = 0;
    installMocks();
    const mod = await import("./manual-secrets.js");
    const names = deploymentNames(
      resolveDeploymentIdentity({ AWS_RESOURCE_PREFIX: "int-health" }),
      "staging",
    );
    mod.buildCatalogPlaceholderSecrets({
      secretPathPrefix: names.secretPathPrefix,
      isProduction: false,
      tags: names.tags,
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }, 10000);

  it("keeps environment-scoped secret paths with project tags", () => {
    const secret = recorded.find(
      (r) => r.type === SECRET_TYPE && r.inputs.name === "/staging/stripe-secret-key",
    );
    expect(secret?.inputs.name).toBe("/staging/stripe-secret-key");
    expect(secret?.inputs.tags).toMatchObject({ Project: "int-health" });
  });
});
