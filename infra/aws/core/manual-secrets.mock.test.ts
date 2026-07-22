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
// to `SecretVersion`. Likewise, the Secrets Manager provider schema marks
// `secretString` as sensitive, so the mock's recorded `inputs.secretString` is
// redacted/unusable — the real AWS SDK wraps it in `pulumi.secret(...)` before
// the mock ever sees it. To verify both for real, we intercept the
// `SecretVersion` constructor itself (via `vi.mock` + `vi.hoisted`, since
// `vi.mock` factories are hoisted above all other module-level code) and
// capture its second and third arguments — the actual `secretString` the
// builder passed (still a plain string here, pre-wrapping) and the
// `pulumi.CustomResourceOptions` the implementation used.
const { recordedVersionOpts, recordedVersionSecretStrings } = vi.hoisted(() => ({
  recordedVersionOpts: [] as (pulumi.CustomResourceOptions | undefined)[],
  recordedVersionSecretStrings: [] as { name: string; secretString: unknown }[],
}));

vi.mock("@pulumi/aws", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@pulumi/aws")>();
  type VersionArgs = ConstructorParameters<typeof actual.secretsmanager.SecretVersion>[1];
  type VersionOpts = ConstructorParameters<typeof actual.secretsmanager.SecretVersion>[2];

  class SpySecretVersion extends actual.secretsmanager.SecretVersion {
    constructor(name: string, args: VersionArgs, opts?: VersionOpts) {
      recordedVersionOpts.push(opts);
      recordedVersionSecretStrings.push({ name, secretString: args.secretString });
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
    recordedVersionSecretStrings.length = 0;
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
    // Assert against what the builder actually passed as `secretString` to the
    // `SecretVersion` constructor (captured pre-wrapping by `SpySecretVersion`
    // above), matched to each secret by the resource name the builder gives
    // it (`manual-<id>-placeholder`) rather than by array order.
    expect(recordedVersionSecretStrings.length).toBe(awsCatalogAppSecrets().length);
    for (const spec of awsCatalogAppSecrets()) {
      const recordedVersion = recordedVersionSecretStrings.find(
        (v) => v.name === `manual-${spec.id}-placeholder`,
      );
      expect(recordedVersion).toBeDefined();
      const secretString = recordedVersion?.secretString;
      expect(typeof secretString).toBe("string");
      expect(secretString).toBe(awsCatalogPlaceholderSeed(spec.id));
      expect(() => JSON.parse(secretString as string)).toThrow();
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
    recordedVersionSecretStrings.length = 0;
    installMocks();
    const mod = await import("./manual-secrets.js");
    const names = deploymentNames(
      resolveDeploymentIdentity({ AWS_RESOURCE_PREFIX: "platform" }),
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
    expect(secret?.inputs.tags).toMatchObject({ Project: "platform" });
  });
});
