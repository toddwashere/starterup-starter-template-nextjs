import { describe, it, expect, beforeAll } from "vitest";
import * as pulumi from "@pulumi/pulumi";

describe("bootstrap layer (mocked)", () => {
  let infra: typeof import("./index");

  beforeAll(async () => {
    pulumi.runtime.setMocks(
      {
        newResource: (args) => {
          const state: Record<string, unknown> = {
            ...args.inputs,
            name: args.inputs["name"] ?? args.name,
          };
          // Service account email is output-only; synthesize it in the mock.
          if (args.type === "gcp:serviceaccount/account:Account") {
            state["email"] = `${args.inputs["accountId"]}@test-project.iam.gserviceaccount.com`;
          }
          return { id: `${args.name}-id`, state };
        },
        call: (args) => args.inputs,
      },
      "starter-gcp-bootstrap",
      "sandbox",
    );
    // sandbox stack → privateNetwork false → network outputs are "".
    pulumi.runtime.setAllConfig({
      "gcp:project": "test-project",
      "gcp:region": "us-central1",
    });
    infra = await import("./index");
  });

  it("exports an Artifact Registry repo path for the project", async () => {
    const repo = await new Promise<string>((res) => infra.artifactRegistryRepo.apply(res));
    expect(repo).toContain("test-project");
    expect(repo).toContain("docker.pkg.dev");
  });

  it("exposes empty network outputs in sandbox (privateNetwork off)", async () => {
    const net = await new Promise<string>((res) => infra.networkId.apply(res));
    expect(net).toBe("");
  });

  it("exports a deploy service account email", async () => {
    const email = await new Promise<string>((res) => infra.deployServiceAccountEmail.apply(res));
    expect(email).toContain("github-deploy");
    expect(email).toContain("test-project.iam.gserviceaccount.com");
  });
});
