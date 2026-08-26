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
  sqsQueueUrl: "https://sqs.us-east-2.amazonaws.com/123456789012/platform-jobs-staging",
  sqsQueueArn: "arn:aws:sqs:us-east-2:123456789012:platform-jobs-staging",
  uploadsBucket: "platform-staging-uploads-abc",
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
 * `specialSigKey` from `@pulumi/pulumi`'s `runtime/rpc.js` — the wire-format
 * signature key present on *any* Pulumi special serialized form (secret, asset,
 * archive, resource reference), not secrets specifically.
 */
const PULUMI_SECRET_SIG = "4dabf18193072939515e22adb298388d";

/**
 * `specialSecretSig` from the same module — the *value* stored under
 * `specialSigKey` that identifies the special form as a secret in particular.
 * Asserting both is what distinguishes "wrapped as a secret" from "wrapped as
 * some other special value".
 */
const PULUMI_SECRET_SIG_VALUE = "1b47061264138c4ac30d75fd1eb44270";

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
  expect(environment[PULUMI_SECRET_SIG]).toBe(PULUMI_SECRET_SIG_VALUE);
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
  return `postgresql://app_db_user:pass@db/app_db?ref=${arn}`;
}

const CATALOG_ARNS = CORE_OUTPUTS.catalogSecretArns as Record<string, string>;

const STACK_OUTPUTS: Record<string, unknown> = {
  ...CORE_OUTPUTS,
  publicAppsZoneId: "ZPUBLICAPPSTAGING",
  publicAppsZoneName: "staging.example.com",
  publicAppsZoneNameServers: ["ns-1.awsdns-01.org", "ns-2.awsdns-02.com"],
  publicAppHostZoneIds: {
    "dashboard-staging.example.com": "ZDASHBOARDSTAGING",
    "api-staging.example.com": "ZAPISTAGING",
    "mcp-staging.example.com": "ZMCPSTAGING",
    "www-staging.example.com": "ZWWWSTAGING",
  },
  appReleaseRoleArn:
    "arn:aws:iam::123456789012:role/platform-staging-github-app-release",
};

/** The ARN a catalog secret id must resolve to, given CORE_OUTPUTS. */
function expectedSecretArn(id: string): string {
  return id === "database-url" ? (CORE_OUTPUTS.databaseUrlSecretArn as string) : CATALOG_ARNS[id];
}

describe("aws apps configured identity (mocked)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    vi.resetModules();
    recorded.length = 0;
    vi.stubEnv("AWS_RESOURCE_PREFIX", "platform");
    vi.stubEnv("PULUMI_ORG", "organization");
    // Apex for derived public URLs (stack mock below is "staging").
    vi.stubEnv("AWS_DNS_ROOT_DOMAIN", "example.com");
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
              state: { ...state, outputs: STACK_OUTPUTS },
            };
          }
          if (args.type.includes("CustomDomainAssociation")) {
            const domain = String(args.inputs.domainName ?? "app.example.com");
            state.dnsTarget = "xxxxxx.us-east-2.awsapprunner.com";
            state.certificateValidationRecords = [
              {
                name: `_a.${domain}`,
                type: "CNAME",
                value: "_v.acm-validations.aws",
              },
              {
                name: `_b.${domain}`,
                type: "CNAME",
                value: "_w.acm-validations.aws",
              },
            ];
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
            if (name && name in STACK_OUTPUTS) {
              return { value: STACK_OUTPUTS[name] };
            }
          }
          if (args.token.includes("getSecretVersion")) {
            const secretId = (args.inputs as { secretId?: string }).secretId;
            return {
              secretString: secretId
                ? secretStringForArn(secretId)
                : "postgresql://app_db_user:pass@db/app_db",
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
    expect(imageRegistry).toBe("123456789012.dkr.ecr.us-east-2.amazonaws.com/platform");
  });

  it("tags app resources with the configured Project identity", () => {
    const tagged = recorded.find((r) => {
      const tags = r.inputs.tags as Record<string, string> | undefined;
      return tags?.Project === "platform" && tags?.Environment === "staging";
    });
    expect(tagged).toBeDefined();
    expect(tagged!.inputs.tags).toMatchObject({
      Project: "platform",
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

  // Called out separately: `www` reads exactly two secrets, and only because
  // its /email/* routes need them (module-scope Prisma in @workspace/campaigns,
  // plus unsubscribe-token verification). Everything else stays off www, so a
  // future catalog edit that widens www's grants trips this test.
  it("gives www exactly DATABASE_URL and CAMPAIGN_UNSUBSCRIBE_SECRET", () => {
    const secrets = imageConfiguration("www").runtimeEnvironmentSecrets ?? {};
    expect(secrets).toEqual({
      DATABASE_URL: expectedSecretArn("database-url"),
      CAMPAIGN_UNSUBSCRIBE_SECRET: expectedSecretArn("campaign-unsubscribe-secret"),
    });
    expect(
      secretsForApp("www")
        .map((s) => s.id)
        .sort(),
    ).toEqual(["campaign-unsubscribe-secret", "database-url"]);
  });

  it.each(APP_RUNNER_APPS)("keeps plaintext secrets out of %s's env vars", (appName: string) => {
    const vars = imageConfiguration(appName).runtimeEnvironmentVariables ?? {};
    expect(Object.keys(vars)).not.toContain("STRIPE_SECRET_KEY");
    expect(Object.keys(vars)).not.toContain("STRIPE_WEBHOOK_SECRET");
    expect(Object.keys(vars)).not.toContain("BETTER_AUTH_SECRET");
  });

  it.each(APP_RUNNER_APPS)(
    "injects derived public URLs into %s",
    (appName: string) => {
      const vars = imageConfiguration(appName).runtimeEnvironmentVariables ?? {};
      // Mock stack is "staging" + AWS_DNS_ROOT_DOMAIN=example.com → flat hosts
      expect(vars.BETTER_AUTH_URL).toBe("https://dashboard-staging.example.com");
      expect(vars.NEXT_PUBLIC_DASHBOARD_URL).toBe(
        "https://dashboard-staging.example.com",
      );
      expect(vars.NEXT_PUBLIC_MCP_URL).toBe("https://mcp-staging.example.com");
      expect(vars.NEXT_PUBLIC_WWW_URL).toBe("https://www-staging.example.com");
    },
  );

  it("associates App Runner custom domains for each service", () => {
    for (const appName of APP_RUNNER_APPS) {
      const assoc = recorded.find(
        (r) =>
          r.type.includes("CustomDomainAssociation") && r.name === `${appName}-custom-domain`,
      );
      expect(assoc).toBeDefined();
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
      [
        ...workersSecrets.map((s) => s.envVar),
        "WORKER_QUEUE_ADAPTER",
        "SQS_QUEUE_URL",
        "BETTER_AUTH_URL",
        "NEXT_PUBLIC_DASHBOARD_URL",
        "NEXT_PUBLIC_WWW_URL",
        "NEXT_PUBLIC_API_URL",
        "NEXT_PUBLIC_MCP_URL",
      ].sort(),
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
