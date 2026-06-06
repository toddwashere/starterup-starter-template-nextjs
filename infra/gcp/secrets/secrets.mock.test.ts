import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";
import {
  SECRET_CATALOG,
  generatedSecrets,
  placeholderSecrets,
} from "../../shared/secret-catalog";

interface Captured {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

const captured: Captured[] = [];

describe("secrets layer (mocked)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          captured.push({ type: args.type, name: args.name, inputs: args.inputs });
          // Differentiate the two StackReferences by their resource name.
          if (args.type === "pulumi:pulumi:StackReference") {
            const name = args.name as string;
            if (name.includes("bootstrap") || name.includes("starter-gcp-bootstrap")) {
              return {
                id: `${args.name}-id`,
                state: {
                  outputs: {
                    projectId: "test-project",
                    regionOut: "us-central1",
                    networkId: "",
                    networkSelfLink: "",
                    subnetSelfLink: "",
                    vpcConnectorId: "",
                    privateServicesConnection: "",
                    artifactRegistryRepo:
                      "us-central1-docker.pkg.dev/test-project/starter",
                    deployServiceAccountEmail:
                      "github-deploy@test-project.iam.gserviceaccount.com",
                    complianceModeOut: "none",
                  },
                },
              };
            }
            // database StackReference: sandbox => dbPrivateIp "" (public/socket form)
            return {
              id: `${args.name}-id`,
              state: {
                outputs: {
                  dbConnectionName: "test-project:us-central1:starter-db-sandbox",
                  dbPrivateIp: "",
                  dbName: "starter",
                  dbUser: "starter",
                  dbPassword: "mock-password",
                },
              },
            };
          }
          return {
            id: `${args.name}-id`,
            state: { ...args.inputs, name: args.inputs.name ?? args.name },
          };
        },
        call: (args) => {
          // Fallback: if StackReference outputs are resolved via the call/invoke
          // path in some @pulumi/pulumi versions, return canned outputs here too.
          if (
            args.token === "pulumi:pulumi:getResource" ||
            args.token === "pulumi:stack:getOutput"
          ) {
            return {
              projectId: "test-project",
              dbConnectionName: "test-project:us-central1:starter-db-sandbox",
              dbPrivateIp: "",
              dbName: "starter",
              dbUser: "starter",
              dbPassword: "mock-password",
            };
          }
          return args.inputs;
        },
      },
      "starter-gcp-secrets",
      "sandbox",
    );

    const sandboxConfig = {
      "gcp:project": "test-project",
      "gcp:region": "us-central1",
      "starter-gcp-secrets:bootstrapStackRef": "org/starter-gcp-bootstrap/sandbox",
      "starter-gcp-secrets:databaseStackRef": "org/starter-gcp-database/sandbox",
    };
    process.env.PULUMI_CONFIG = JSON.stringify(sandboxConfig);
    pulumi.runtime.setAllConfig(sandboxConfig);

    infra = await import("./index");
    // Pulumi registers resources asynchronously in microtasks after the module
    // is imported. Yield to the event loop so all newResource calls complete
    // before the tests read the `captured` array.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }, 10000);

  it("creates a Secret resource for every SECRET_CATALOG entry", () => {
    const secretIds = captured
      .filter((c) => c.type === "gcp:secretmanager/secret:Secret")
      .map((c) => c.inputs.secretId);
    for (const d of SECRET_CATALOG) {
      expect(secretIds).toContain(d.id);
    }
  });

  it("creates a SecretVersion for every generated secret (incl. database-url)", () => {
    const versionResources = captured.filter(
      (c) => c.type === "gcp:secretmanager/secretVersion:SecretVersion",
    );
    // One version per generated secret (database-url included).
    expect(versionResources.length).toBe(generatedSecrets().length);
  });

  it("creates NO SecretVersion for placeholder secrets", () => {
    const versionResourceNames = captured
      .filter((c) => c.type === "gcp:secretmanager/secretVersion:SecretVersion")
      .map((c) => c.name);
    for (const d of placeholderSecrets()) {
      expect(versionResourceNames.some((n) => n.startsWith(`${d.id}-`))).toBe(false);
    }
  });

  it("exports one secretIds entry per catalog id and a databaseUrlSecretName", async () => {
    expect(Object.keys(infra.secretIds).sort()).toEqual(
      SECRET_CATALOG.map((d) => d.id).sort(),
    );
    const dbName = await new Promise<string>((res) =>
      infra.databaseUrlSecretName.apply(res),
    );
    expect(dbName).toBeDefined();
  });
});
