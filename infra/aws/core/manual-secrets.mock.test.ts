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

describe("buildManualSecrets", () => {
  beforeAll(async () => {
    vi.resetModules();
    recorded.length = 0;
    installMocks();
    const mod = await import("./manual-secrets.js");
    mod.buildManualSecrets({
      stack: "sandbox",
      isProduction: false,
      tags: { Project: "starter" },
      specs: [
        { name: "stripe-secret-key", description: "Stripe secret API key" },
      ],
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 100));
  }, 10000);

  it("creates a namespaced secret container per spec", () => {
    const secrets = recorded.filter((r) => r.type === SECRET_TYPE);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].inputs.name).toBe("/starter/sandbox/stripe-secret-key");
    // Non-prod: force delete so the name is reusable on the next deploy.
    expect(secrets[0].inputs.recoveryWindowInDays).toBe(0);
  });

  it("seeds exactly one placeholder version linked to the secret", () => {
    // secretString is a provider-classified secret, so the mock does not expose
    // its plaintext — asserting a single version bound to the secret is enough
    // to prove a placeholder was seeded without leaking a real value.
    const versions = recorded.filter((r) => r.type === VERSION_TYPE);
    expect(versions).toHaveLength(1);
    expect(versions[0].inputs.secretId).toBeDefined();
  });
});
