import { describe, it, expect } from "vitest";
import { appRunnerRoute53ZoneId } from "./apprunner-route53";

describe("appRunnerRoute53ZoneId", () => {
  it("returns the us-east-2 App Runner alias zone id", () => {
    expect(appRunnerRoute53ZoneId("us-east-2")).toBe("Z0224347AD7KVHMLOX31");
  });

  it("throws for an unmapped region", () => {
    expect(() => appRunnerRoute53ZoneId("xx-test-1")).toThrow(/No App Runner Route 53/);
  });
});
