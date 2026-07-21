import { beforeAll, describe, expect, it, vi } from "vitest";
import * as pulumi from "@pulumi/pulumi";

import { SECRET_CATALOG, secretsForApp } from "../../shared/secret-catalog";
import { workersRuntimeSecretIds } from "./app-secrets";

interface RecordedResource {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const recorded: RecordedResource[] = [];

const SERVICE_TYPE = "aws:apprunner/service:Service";
const ROLE_POLICY_TYPE = "aws:iam/rolePolicy:RolePolicy";
const FUNCTION_TYPE = "aws:lambda/function:Function";

/** The four App Runner services index.ts creates (workers is a Lambda). */
const APP_RUNNER_APPS = ["dashboard", "www", "public-api", "public-mcp"] as const;

const CORE_OUTPUTS: Record<string, unknown> = {
  privateSubnetIds: ["subnet-1", "subnet-2"],
  appSecurityGroupId: "sg-app",
  databaseUrlSecretArn:
    "arn:aws:secretsmanager:us-east-2:123456789012:secret:/staging/database-url",
  directUrlSecretArn: "arn:aws:secretsmanager:us-east-2:123456789012:secret:/staging/direct-url",
  sqsQueueUrl: "https://sqs.us-east-2.amazonaws.com/123456789012/int-health-jobs-staging",
  sqsQueueArn: "arn:aws:sqs:us-east-2:123456789012:int-health-jobs-staging",
  uploadsBucket: "int-health-staging-uploads-abc",
  wafWebAclArn: "",
  // Catalog placeholder ARNs the core stack now exports (everything in
  // SECRET_CATALOG except `database-url`).
  catalogSecretArns: Object.fromEntries(
    SECRET_CATALOG.filter((s) => s.id !== "database-url").map((s) => [
      s.id,
      `arn:aws:secretsmanager:us-east-2:123456789012:secret:/staging/${s.id}`,
    ]),
  ),
};

// --- Helpers over `recorded[]` ---------------------------------------------

function findResource(type: string, name: string): RecordedResource {
  const found = recorded.find((r) => r.type === type && r.name === name);
  if (!found) throw new Error(`no recorded ${type} named "${name}"`);
  return found;
}

interface ImageConfiguration {
  runtimeEnvironmentSecrets?: Record<string, string>;
  runtimeEnvironmentVariables?: Record<string, string>;
}

function imageConfiguration(appName: string): ImageConfiguration {
  const source = findResource(SERVICE_TYPE, appName).inputs.sourceConfiguration as {
    imageRepository: { imageConfiguration: ImageConfiguration };
  };
  return source.imageRepository.imageConfiguration;
}

interface PolicyStatement {
  Effect: string;
  Action: string[];
  Resource: unknown;
}

function policyStatements(policyName: string): PolicyStatement[] {
  const policy = findResource(ROLE_POLICY_TYPE, policyName).inputs.policy as string;
  return (JSON.parse(policy) as { Statement: PolicyStatement[] }).Statement;
}

/** Resource list of the single `secretsmanager:GetSecretValue` statement. */
function secretReadResources(policyName: string): string[] {
  const statements = policyStatements(policyName).filter((s) =>
    (s.Action ?? []).includes("secretsmanager:GetSecretValue"),
  );
  expect(statements).toHaveLength(1);
  const resource = statements[0].Resource;
  expect(Array.isArray(resource)).toBe(true);
  return resource as string[];
}

/**
 * Pulumi's well-known signature key marking a value as a wrapped secret
 * (`@pulumi/pulumi`'s `specialSigKey`/`specialSecretSig` in `runtime/rpc.js`).
 * This is the JS SDK's internal sentinel, not the gRPC wire-format one.
 */
const PULUMI_SECRET_SIG = "4dabf18193072939515e22adb298388d";

/**
 * Pulumi wraps an input containing a secret in `{ <sig>: <sig>, value: ... }`.
 * The workers Lambda's env holds `pulumi.secret(...)` values, so it must arrive
 * wrapped. Assert the wrapper rather than falling back to the raw value: a
 * silent fallback would let `pulumi.secret(...)` be dropped from index.ts
 * without any test noticing that the env is now plaintext in stack state.
 */
function workersLambdaEnvVars(): Record<string, string> {
  const environment = findResource(FUNCTION_TYPE, "workers").inputs.environment as Record<
    string,
    unknown
  >;
  expect(environment).toHaveProperty(PULUMI_SECRET_SIG);
  expect("value" in environment).toBe(true);
  const unwrapped = environment.value as {
    variables: Record<string, string>;
  };
  return unwrapped.variables;
}

/**
 * Matches the mock `getSecretVersion` handler below: the canned secret string
 * with the requested secret's own ARN appended, so each env var's resolved
 * value can be tied back to the specific secret it was supposed to read.
 */
function secretStringForArn(arn: string): string {
  return `postgresql://starter:pass@db/starter?ref=${arn}`;
}

const CATALOG_ARNS = CORE_OUTPUTS.catalogSecretArns as Record<string, string>;

/** The ARN a catalog secret id must resolve to, given CORE_OUTPUTS. */
function expectedSecretArn(id: string): string {
  return id === "database-url" ? (CORE_OUTPUTS.databaseUrlSecretArn as string) : CATALOG_ARNS[id];
}

describe("aws apps configured identity (mocked)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    vi.resetModules();
    recorded.length = 0;
    vi.stubEnv("AWS_RESOURCE_PREFIX", "int-health");
    vi.stubEnv("PULUMI_ORG", "organization");
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          recorded.push({
            type: args.type,
            name: args.name,
            inputs: args.inputs,
          });
          const state: Record<string, unknown> = {
            ...args.inputs,
            arn: `arn:aws:iam::123456789012:${args.name}`,
            serviceUrl: `https://${args.name}.example.com`,
          };
          if (args.type === "pulumi:pulumi:StackReference") {
            return {
              id: `${args.name}-id`,
              state: { ...state, outputs: CORE_OUTPUTS },
            };
          }
          return {
            id: `${args.name}-id`,
            state,
          };
        },
        call: (args) => {
          if (args.token.includes("getCallerIdentity")) {
            return {
              accountId: "123456789012",
              arn: "arn:aws:iam::123456789012:user/test",
              userId: "test",
            };
          }
          if (
            args.token.includes("getStackReferenceOutput") ||
            args.token.includes("StackReference")
          ) {
            const name = (args.inputs as { name?: string }).name;
            if (name && name in CORE_OUTPUTS) {
              return { value: CORE_OUTPUTS[name] };
            }
          }
          if (args.token.includes("getSecretVersion")) {
            const secretId = (args.inputs as { secretId?: string }).secretId;
            return {
              secretString: secretId
                ? secretStringForArn(secretId)
                : "postgresql://starter:pass@db/starter",
              versionId: "1",
            };
          }
          return args.inputs;
        },
      },
      "starter-aws-apps",
      "staging",
    );
    pulumi.runtime.setAllConfig({
      "aws:region": "us-east-2",
    });
    infra = await import("./index");
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }, 20000);

  it("resolves the ECR registry under the configured identity", async () => {
    const imageRegistry = await new Promise<string>((resolve) =>
      pulumi.output(infra.imageRegistry).apply(resolve),
    );
    expect(imageRegistry).toBe("123456789012.dkr.ecr.us-east-2.amazonaws.com/int-health");
  });

  it("tags app resources with the configured Project identity", () => {
    const tagged = recorded.find((r) => {
      const tags = r.inputs.tags as Record<string, string> | undefined;
      return tags?.Project === "int-health" && tags?.Environment === "staging";
    });
    expect(tagged).toBeDefined();
    expect(tagged!.inputs.tags).toMatchObject({
      Project: "int-health",
      Environment: "staging",
      ManagedBy: "pulumi",
    });
  });

  // --- Catalog secret wiring -------------------------------------------------

  it.each(APP_RUNNER_APPS)(
    "wires %s's runtimeEnvironmentSecrets from the catalog",
    (appName: string) => {
      const catalogSecrets = secretsForApp(appName);
      const actual = imageConfiguration(appName).runtimeEnvironmentSecrets ?? {};

      // Expectation is derived from the catalog, so the test tracks it.
      expect(Object.keys(actual).sort()).toEqual(catalogSecrets.map((s) => s.envVar).sort());
      expect(actual).toEqual(
        Object.fromEntries(catalogSecrets.map((s) => [s.envVar, expectedSecretArn(s.id)])),
      );
    },
  );

  // Called out separately: `www` has no catalog readers at all, so it must lose
  // DATABASE_URL entirely. This is the deliberate, surprising behavior that
  // would otherwise regress silently.
  it("gives www no runtime secrets at all (not even DATABASE_URL)", () => {
    const secrets = imageConfiguration("www").runtimeEnvironmentSecrets ?? {};
    expect(secrets).toEqual({});
    expect(secretsForApp("www")).toEqual([]);
  });

  it.each(APP_RUNNER_APPS)("keeps plaintext secrets out of %s's env vars", (appName: string) => {
    const vars = imageConfiguration(appName).runtimeEnvironmentVariables ?? {};
    expect(Object.keys(vars)).not.toContain("STRIPE_SECRET_KEY");
    expect(Object.keys(vars)).not.toContain("STRIPE_WEBHOOK_SECRET");
    expect(Object.keys(vars)).not.toContain("BETTER_AUTH_SECRET");
  });

  it.each(APP_RUNNER_APPS)("keeps %s's non-secret URL bootstrapping", (appName: string) => {
    const vars = imageConfiguration(appName).runtimeEnvironmentVariables ?? {};
    expect(vars.BETTER_AUTH_URL).toBe("http://127.0.0.1:4000");
    expect(vars.NEXT_PUBLIC_BETTER_AUTH_URL).toBe("http://127.0.0.1:4000");
  });

  it("keeps NEXT_PUBLIC_MCP_URL on public-mcp only", () => {
    expect(imageConfiguration("public-mcp").runtimeEnvironmentVariables?.NEXT_PUBLIC_MCP_URL).toBe(
      "http://127.0.0.1:4003",
    );
    for (const appName of APP_RUNNER_APPS.filter((n) => n !== "public-mcp")) {
      expect(
        Object.keys(imageConfiguration(appName).runtimeEnvironmentVariables ?? {}),
      ).not.toContain("NEXT_PUBLIC_MCP_URL");
    }
  });

  it("enumerates the instance role's readable secret ARNs without a wildcard", () => {
    const resources = secretReadResources("apprunner-instance-policy");
    for (const resource of resources) {
      expect(resource).not.toContain("*");
    }
    expect([...resources].sort()).toEqual(
      [
        CORE_OUTPUTS.databaseUrlSecretArn as string,
        CORE_OUTPUTS.directUrlSecretArn as string,
        ...Object.values(CATALOG_ARNS),
      ].sort(),
    );
  });

  it("scopes the workers role to exactly workersRuntimeSecretIds() without a wildcard", () => {
    const resources = secretReadResources("workers-inline");
    for (const resource of resources) {
      expect(resource).not.toContain("*");
    }
    expect([...resources].sort()).toEqual(workersRuntimeSecretIds().map(expectedSecretArn).sort());
  });

  it("injects the catalog's workers secrets into the Lambda environment, wired to their own secret", () => {
    const envVars = workersLambdaEnvVars();
    const workersSecrets = secretsForApp("workers");

    const keys = Object.keys(envVars).sort();
    expect(keys).toEqual(
      [...workersSecrets.map((s) => s.envVar), "WORKER_QUEUE_ADAPTER", "SQS_QUEUE_URL"].sort(),
    );

    // The mock's getSecretVersion echoes back the requested secretId (ARN), so
    // each env var's resolved value can be tied to the specific secret it was
    // supposed to read -- catching an envVar mis-wired to a different secret's
    // ARN, which a key-set-only check would miss.
    for (const secret of workersSecrets) {
      expect(envVars[secret.envVar]).toBe(secretStringForArn(expectedSecretArn(secret.id)));
    }
  });
});
