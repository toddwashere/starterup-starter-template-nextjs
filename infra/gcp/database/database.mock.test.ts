import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

interface Created {
  type: string;
  name: string;
  inputs: Record<string, unknown>;
}

describe("database layer (mocked)", () => {
  let infra: typeof import("./index");
  const created: Created[] = [];

  beforeAll(async () => {
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          created.push({ type: args.type, name: args.name, inputs: args.inputs });
          // bootstrap StackReference: always supplies a non-empty network (Tasks 1-2 guarantee this).
          if (args.type === "pulumi:pulumi:StackReference") {
            return {
              id: `${args.name}-id`,
              state: {
                outputs: {
                  projectId: "test-project",
                  regionOut: "us-central1",
                  networkId: "projects/test-project/global/networks/starter-vpc",
                  networkSelfLink:
                    "https://www.googleapis.com/compute/v1/projects/test-project/global/networks/starter-vpc",
                  subnetSelfLink: "",
                  vpcConnectorId: "projects/test-project/locations/us-central1/connectors/starter-connector",
                  privateServicesConnection: "",
                  artifactRegistryRepo:
                    "us-central1-docker.pkg.dev/test-project/platform",
                  deployServiceAccountEmail:
                    "github-deploy@test-project.iam.gserviceaccount.com",
                  complianceModeOut: "none",
                },
              },
            };
          }
          if (args.type === "gcp:sql/databaseInstance:DatabaseInstance") {
            return {
              id: `${args.name}-id`,
              state: {
                ...args.inputs,
                name: args.inputs.name ?? args.name,
                connectionName: "test-project:us-central1:platform-db-sandbox",
                privateIpAddress: "10.10.0.3",
              },
            };
          }
          return {
            id: `${args.name}-id`,
            state: { ...args.inputs, name: args.inputs.name ?? args.name },
          };
        },
        call: (args) => args.inputs,
      },
      "starter-gcp-database",
      "sandbox",
    );
    // sandbox stack config. Use both PULUMI_CONFIG env injection and
    // setAllConfig to ensure config resolves across Pulumi versions.
    const sandboxConfig = {
      "gcp:project": "test-project",
      "gcp:region": "us-central1",
      "starter-gcp-database:bootstrapStackRef":
        "organization/starter-gcp-bootstrap/sandbox",
      "starter-gcp-database:dbTier": "db-f1-micro",
      "starter-gcp-database:dbVersion": "POSTGRES_16",
      "starter-gcp-database:dbAvailability": "ZONAL",
      "starter-gcp-database:dbPointInTime": "false",
    };
    process.env.PULUMI_CONFIG = JSON.stringify(sandboxConfig);
    pulumi.runtime.setAllConfig(sandboxConfig);
    infra = await import("./index");
    // Pulumi registers resources asynchronously in microtasks after the module
    // is imported. Yield to the event loop so all newResource calls complete
    // before the tests read the `created` array.
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
  }, 10000);

  it("creates the Cloud SQL instance with deletionProtection enabled", () => {
    const inst = created.find(
      (r) => r.type === "gcp:sql/databaseInstance:DatabaseInstance",
    );
    expect(inst).toBeDefined();
    expect(inst!.inputs.deletionProtection).toBe(true);
  });

  it("uses a private IP in every environment (bootstrap network present)", async () => {
    const inst = created.find(
      (r) => r.type === "gcp:sql/databaseInstance:DatabaseInstance",
    );
    const ipConfig = await new Promise<{ ipv4Enabled?: boolean; privateNetwork?: string }>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (res) => (pulumi.output(inst!.inputs.settings) as pulumi.Output<any>).apply((s: any) => res(s.ipConfiguration)),
    );
    expect(ipConfig.ipv4Enabled).toBe(false);
    expect(ipConfig.privateNetwork).toBeTruthy();
  });

  it("exports a non-empty dbPrivateIp when private", async () => {
    const ip = await new Promise<string>((res) => infra.dbPrivateIp.apply(res));
    expect(ip).toBe("10.10.0.3");
  });

  it("exports non-empty connection facts for downstream layers", async () => {
    const conn = await new Promise<string>((res) => infra.dbConnectionName.apply(res));
    const name = await new Promise<string>((res) => infra.dbName.apply(res));
    const userName = await new Promise<string>((res) => infra.dbUser.apply(res));
    const instanceName = await new Promise<string>((res) => infra.sqlInstanceName.apply(res));
    expect(conn).toContain("test-project");
    expect(name).toBe("app_db");
    expect(userName).toBe("app_db_user");
    expect(instanceName).toContain("platform-db");
  });
});
