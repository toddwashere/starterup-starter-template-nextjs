import { describe, expect, it, vi } from "vitest";
import { deploymentNames, resolveDeploymentIdentity } from "./naming";

describe("resolveDeploymentIdentity", () => {
  it("defaults to starter", () => {
    expect(resolveDeploymentIdentity({}).value).toBe("starter");
    expect(resolveDeploymentIdentity({}).source).toBe("default");
  });

  it("uses AWS_RESOURCE_PREFIX for global identity and prefixed queue names", () => {
    const identity = resolveDeploymentIdentity({ AWS_RESOURCE_PREFIX: "int-health" });
    expect(identity.source).toBe("canonical");
    const names = deploymentNames(identity, "staging");
    expect(names.ecrNamespace).toBe("int-health");
    expect(names.globalPrefix).toBe("int-health-staging");
    expect(names.secretPathPrefix).toBe("/staging");
    expect(names.logGroupPrefix).toBe("/staging");
    expect(names.deployRoleName).toBe("int-health-staging-github-deploy");
    expect(names.tags).toEqual({
      Project: "int-health",
      Environment: "staging",
      ManagedBy: "pulumi",
    });
    expect(names.queueName("jobs")).toBe("int-health-jobs-staging");
    expect(names.queueName("jobs", { dlq: true })).toBe("int-health-jobs-staging-dlq");
  });

  it("warns for the legacy alias and rejects a conflict", () => {
    const warn = vi.fn();
    const legacy = resolveDeploymentIdentity({ AWS_STATE_RESOURCE_PREFIX: "int-health" }, warn);
    expect(legacy).toEqual({ value: "int-health", source: "legacy" });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0]?.[0]).toMatch(/AWS_STATE_RESOURCE_PREFIX/);
    expect(() =>
      resolveDeploymentIdentity({
        AWS_RESOURCE_PREFIX: "int-health",
        AWS_STATE_RESOURCE_PREFIX: "other",
      }),
    ).toThrow("must match");
  });

  it("rejects invalid prefixes", () => {
    expect(() => resolveDeploymentIdentity({ AWS_RESOURCE_PREFIX: "Not_Valid" })).toThrow(
      /AWS_RESOURCE_PREFIX/,
    );
    expect(() => resolveDeploymentIdentity({ AWS_RESOURCE_PREFIX: "-bad" })).toThrow(
      /AWS_RESOURCE_PREFIX/,
    );
    expect(() => resolveDeploymentIdentity({ AWS_RESOURCE_PREFIX: "a".repeat(30) })).toThrow(
      /AWS_RESOURCE_PREFIX/,
    );
  });

  it("accepts matching canonical and legacy values without warning", () => {
    const warn = vi.fn();
    const identity = resolveDeploymentIdentity(
      {
        AWS_RESOURCE_PREFIX: "int-health",
        AWS_STATE_RESOURCE_PREFIX: "int-health",
      },
      warn,
    );
    expect(identity).toEqual({ value: "int-health", source: "canonical" });
    expect(warn).not.toHaveBeenCalled();
  });
});
