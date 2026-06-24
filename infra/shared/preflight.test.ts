import { describe, it, expect } from "vitest";
import { runPreflight, type PreflightInput } from "./preflight";

const ok: PreflightInput = {
  authenticated: true,
  billingLinked: true,
  projectExists: true,
  stateBucketReachable: true,
  config: { "gcp:project": "p", "gcp:region": "us-central1" },
  requiredKeys: ["gcp:project", "gcp:region"],
};

describe("runPreflight", () => {
  it("passes when all preconditions hold", () => {
    expect(runPreflight(ok)).toEqual({ ok: true, errors: [], warnings: [] });
  });

  it("fails on missing auth", () => {
    const r = runPreflight({ ...ok, authenticated: false });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => /authenticat/i.test(e))).toBe(true);
  });

  it("fails on unlinked billing", () => {
    expect(runPreflight({ ...ok, billingLinked: false }).errors.some((e) => /billing/i.test(e))).toBe(true);
  });

  it("fails on missing project", () => {
    expect(runPreflight({ ...ok, projectExists: false }).errors.some((e) => /project/i.test(e))).toBe(true);
  });

  it("fails on unreachable state bucket", () => {
    expect(runPreflight({ ...ok, stateBucketReachable: false }).errors.some((e) => /state bucket/i.test(e))).toBe(true);
  });

  it("fails listing each missing required config key", () => {
    const r = runPreflight({ ...ok, config: { "gcp:project": "p" } });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("gcp:region"))).toBe(true);
  });

  it("aggregates multiple errors", () => {
    const r = runPreflight({ ...ok, authenticated: false, billingLinked: false });
    expect(r.errors.length).toBeGreaterThanOrEqual(2);
  });

  it("fails on env config critical issues and surfaces warnings", () => {
    const r = runPreflight({
      ...ok,
      envConfig: {
        critical: ["Missing required domains.base."],
        warnings: ["bootstrap.githubRepo is empty"],
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors.some((e) => e.includes("domains.base"))).toBe(true);
    expect(r.warnings).toContain("bootstrap.githubRepo is empty");
  });
});
