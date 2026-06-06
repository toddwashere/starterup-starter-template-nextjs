import { describe, it, expect } from "vitest";
import { resolveCompliance } from "./compliance";

describe("resolveCompliance", () => {
  it("none disables every control", () => {
    const c = resolveCompliance("none");
    expect(c).toMatchObject({
      auditLogs: false,
      immutableLogSink: false,
      cmek: false,
      orgPolicies: false,
      binaryAuthorization: false,
      cloudArmor: false,
      vpcServiceControls: false,
      logRetentionDays: 0,
    });
  });

  it("hipaa enables all controls with 2190-day retention", () => {
    const c = resolveCompliance("hipaa");
    expect(c.auditLogs).toBe(true);
    expect(c.immutableLogSink).toBe(true);
    expect(c.cmek).toBe(true);
    expect(c.orgPolicies).toBe(true);
    expect(c.logRetentionDays).toBe(2190);
  });

  it("soc2 uses 365-day retention", () => {
    expect(resolveCompliance("soc2").logRetentionDays).toBe(365);
  });

  it("hipaa+soc2 takes the longer retention", () => {
    expect(resolveCompliance("hipaa+soc2").logRetentionDays).toBe(2190);
  });

  it("overrides.logRetentionDays wins", () => {
    expect(resolveCompliance("soc2", { logRetentionDays: 730 }).logRetentionDays).toBe(730);
  });

  it("vpcServiceControls defaults off even when compliant, opt-in via override", () => {
    expect(resolveCompliance("hipaa").vpcServiceControls).toBe(false);
    expect(resolveCompliance("hipaa", { vpcServiceControls: true }).vpcServiceControls).toBe(true);
  });
});
