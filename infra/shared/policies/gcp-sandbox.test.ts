import { describe, it, expect, vi } from "vitest";
import {
  noGlobalForwardingRulesInSandbox,
  maxInstanceCountSandboxCap,
  noAllUsersOnNonPublicService,
  noPrimitiveRolesOnRuntimeSa,
} from "./gcp-sandbox-validators";

describe("noGlobalForwardingRulesInSandbox", () => {
  it("flags a GlobalForwardingRule in sandbox", () => {
    const report = vi.fn();
    noGlobalForwardingRulesInSandbox(
      "sandbox",
      "gcp:compute/globalForwardingRule:GlobalForwardingRule",
      report,
    );
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain("denied in sandbox");
  });

  it("ignores production GlobalForwardingRule", () => {
    const report = vi.fn();
    noGlobalForwardingRulesInSandbox(
      "production",
      "gcp:compute/globalForwardingRule:GlobalForwardingRule",
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });

  it("ignores other resource types in sandbox", () => {
    const report = vi.fn();
    noGlobalForwardingRulesInSandbox("sandbox", "gcp:compute/instance:Instance", report);
    expect(report).not.toHaveBeenCalled();
  });
});

describe("maxInstanceCountSandboxCap", () => {
  it("flags Cloud Run with maxInstanceCount > 2 in sandbox", () => {
    const report = vi.fn();
    maxInstanceCountSandboxCap(
      "sandbox",
      "gcp:cloudrunv2/service:Service",
      { name: "dashboard", template: { scaling: { maxInstanceCount: 5 } } },
      report,
    );
    expect(report).toHaveBeenCalledTimes(1);
    expect(report.mock.calls[0][0]).toContain("maxInstanceCount=5");
  });

  it("allows Cloud Run with maxInstanceCount <= 2", () => {
    const report = vi.fn();
    maxInstanceCountSandboxCap(
      "sandbox",
      "gcp:cloudrunv2/service:Service",
      { name: "dashboard", template: { scaling: { maxInstanceCount: 2 } } },
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });

  it("allows Cloud Run with maxInstanceCount exactly 1", () => {
    const report = vi.fn();
    maxInstanceCountSandboxCap(
      "sandbox",
      "gcp:cloudrunv2/service:Service",
      { name: "api", template: { scaling: { maxInstanceCount: 1 } } },
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });

  it("ignores cap in production", () => {
    const report = vi.fn();
    maxInstanceCountSandboxCap(
      "production",
      "gcp:cloudrunv2/service:Service",
      { name: "dashboard", template: { scaling: { maxInstanceCount: 100 } } },
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });

  it("ignores non-CloudRun resource types in sandbox", () => {
    const report = vi.fn();
    maxInstanceCountSandboxCap(
      "sandbox",
      "gcp:compute/instance:Instance",
      { name: "vm", template: { scaling: { maxInstanceCount: 10 } } },
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });

  it("ignores Cloud Run with no scaling config set", () => {
    const report = vi.fn();
    maxInstanceCountSandboxCap(
      "sandbox",
      "gcp:cloudrunv2/service:Service",
      { name: "dashboard", template: {} },
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });
});

describe("noAllUsersOnNonPublicService", () => {
  it("flags allUsers invoker on a worker service binding", () => {
    const report = vi.fn();
    noAllUsersOnNonPublicService(
      "gcp:cloudrunv2/serviceIamMember:ServiceIamMember",
      { name: "starter-workers", member: "allUsers" },
      ["starter-workers"],
      report,
    );
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("allows allUsers invoker on a public service", () => {
    const report = vi.fn();
    noAllUsersOnNonPublicService(
      "gcp:cloudrunv2/serviceIamMember:ServiceIamMember",
      { name: "starter-www", member: "allUsers" },
      ["starter-workers"],
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });
});

describe("noPrimitiveRolesOnRuntimeSa", () => {
  it("flags roles/owner bound to a member", () => {
    const report = vi.fn();
    noPrimitiveRolesOnRuntimeSa(
      "gcp:projects/iAMMember:IAMMember",
      { role: "roles/owner", member: "serviceAccount:x@y.iam" },
      report,
    );
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("allows a scoped role", () => {
    const report = vi.fn();
    noPrimitiveRolesOnRuntimeSa(
      "gcp:projects/iAMMember:IAMMember",
      { role: "roles/cloudsql.client", member: "serviceAccount:x@y.iam" },
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });

  it("flags roles/owner on an IAMBinding resource type", () => {
    const report = vi.fn();
    noPrimitiveRolesOnRuntimeSa(
      "gcp:projects/iAMBinding:IAMBinding",
      { role: "roles/owner" },
      report,
    );
    expect(report).toHaveBeenCalledTimes(1);
  });

  it("ignores a scoped role on IAMBinding", () => {
    const report = vi.fn();
    noPrimitiveRolesOnRuntimeSa(
      "gcp:projects/iAMBinding:IAMBinding",
      { role: "roles/run.invoker" },
      report,
    );
    expect(report).not.toHaveBeenCalled();
  });
});
