import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

describe("apps layer (mocked, sandbox)", () => {
  const created: { type: string; name: string; inputs: Record<string, unknown> }[] = [];
  let infra: typeof import("./index");

  beforeAll(async () => {
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          created.push({ type: args.type, name: args.name, inputs: args.inputs });

          // StackReferences: return canned outputs per layer.
          if (args.type === "pulumi:pulumi:StackReference") {
            const name = args.name as string;
            if (name.includes("bootstrap")) {
              return {
                id: `${args.name}-id`,
                state: {
                  outputs: {
                    projectId: "test-project",
                    regionOut: "us-central1",
                    vpcConnectorId: "",
                    artifactRegistryRepo: "us-central1-docker.pkg.dev/test-project/starter",
                    complianceModeOut: "none",
                  },
                },
              };
            }
            if (name.includes("database")) {
              return {
                id: `${args.name}-id`,
                state: {
                  outputs: {
                    dbConnectionName: "test-project:us-central1:starter-db-sandbox",
                    dbPrivateIp: "",
                  },
                },
              };
            }
            if (name.includes("storage")) {
              return {
                id: `${args.name}-id`,
                state: {
                  outputs: {
                    uploadsBucketName: "test-project-uploads-sandbox",
                  },
                },
              };
            }
            if (name.includes("messaging")) {
              return {
                id: `${args.name}-id`,
                state: {
                  outputs: {
                    pubsubTopicName: "jobs-sandbox",
                    redisHost: "",
                    redisPort: 6379,
                  },
                },
              };
            }
            if (name.includes("secrets")) {
              return {
                id: `${args.name}-id`,
                state: {
                  outputs: {
                    secretIds: {
                      "database-url": "database-url",
                      "better-auth-secret": "better-auth-secret",
                      "campaign-unsubscribe-secret": "campaign-unsubscribe-secret",
                      "stripe-secret-key": "stripe-secret-key",
                      "stripe-webhook-secret": "stripe-webhook-secret",
                      "resend-api-key": "resend-api-key",
                      "openrouter-api-key": "openrouter-api-key",
                      "sentry-dsn": "sentry-dsn",
                    },
                    databaseUrlSecretName: "database-url",
                  },
                },
              };
            }
            // Fallback for any StackReference
            return {
              id: `${args.name}-id`,
              state: {
                outputs: {
                  projectId: "test-project",
                  regionOut: "us-central1",
                  vpcConnectorId: "",
                  artifactRegistryRepo: "us-central1-docker.pkg.dev/test-project/starter",
                  dbConnectionName: "test-project:us-central1:starter-db-sandbox",
                  dbPrivateIp: "",
                  uploadsBucketName: "test-project-uploads-sandbox",
                  pubsubTopicName: "jobs-sandbox",
                  redisHost: "",
                  redisPort: 6379,
                  secretIds: {},
                  databaseUrlSecretName: "database-url",
                },
              },
            };
          }

          return {
            id: `${args.name}-id`,
            state: {
              ...args.inputs,
              uri: `https://${args.name}.run.app`,
              name: args.inputs.name ?? args.name,
            },
          };
        },
        call: (args) => {
          // Fallback for StackReference output resolution via the call path.
          return {
            projectId: "test-project",
            regionOut: "us-central1",
            vpcConnectorId: "",
            artifactRegistryRepo: "us-central1-docker.pkg.dev/test-project/starter",
            dbConnectionName: "test-project:us-central1:starter-db-sandbox",
            dbPrivateIp: "",
            uploadsBucketName: "test-project-uploads-sandbox",
            pubsubTopicName: "jobs-sandbox",
            redisHost: "",
            redisPort: 6379,
            secretIds: {
              "database-url": "database-url",
              "better-auth-secret": "better-auth-secret",
            },
            databaseUrlSecretName: "database-url",
            ...args.inputs,
          };
        },
      },
      "starter-gcp-apps",
      "sandbox",
    );

    const sandboxConfig = {
      "gcp:project": "test-project",
      "gcp:region": "us-central1",
      "starter-gcp-apps:bootstrapStackRef": "organization/starter-gcp-bootstrap/sandbox",
      "starter-gcp-apps:databaseStackRef": "organization/starter-gcp-database/sandbox",
      "starter-gcp-apps:storageStackRef": "organization/starter-gcp-storage/sandbox",
      "starter-gcp-apps:messagingStackRef": "organization/starter-gcp-messaging/sandbox",
      "starter-gcp-apps:secretsStackRef": "organization/starter-gcp-secrets/sandbox",
    };
    process.env.PULUMI_CONFIG = JSON.stringify(sandboxConfig);
    pulumi.runtime.setAllConfig(sandboxConfig);

    infra = await import("./index");
    // Pulumi registers resources asynchronously in microtasks after the module
    // is imported. Yield to the event loop so all newResource calls complete
    // before the tests read the `created` array.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }, 10000);

  it("creates a Cloud Run service per app", () => {
    const svc = created.filter((r) => r.type === "gcp:cloudrunv2/service:Service");
    expect(svc.length).toBe(5);
  });

  it("workers service is internal-only ingress", () => {
    const workers = created.find(
      (r) => r.type === "gcp:cloudrunv2/service:Service" && r.name === "workers",
    );
    expect(workers?.inputs.ingress).toBe("INGRESS_TRAFFIC_INTERNAL_ONLY");
  });

  it("never grants allUsers invoker to workers", () => {
    const invokers = created.filter(
      (r) => r.type === "gcp:cloudrunv2/serviceIamMember:ServiceIamMember",
    );
    expect(invokers.some((r) => r.name === "workers-public")).toBe(false);
    expect(invokers.some((r) => r.name === "dashboard-public")).toBe(true);
  });

  it("creates the migrate job", () => {
    expect(created.some((r) => r.type === "gcp:cloudrunv2/job:Job")).toBe(true);
  });

  it("creates no GlobalForwardingRule in sandbox (LB off)", () => {
    expect(created.some((r) => r.type.includes("GlobalForwardingRule"))).toBe(false);
  });
});
