import { describe, expect, it } from "vitest";
import { formatAwsNextSteps } from "./infra-init-next-steps";

describe("formatAwsNextSteps", () => {
  it("requires central state initialization before optional Pulumi layers", () => {
    const output = formatAwsNextSteps("sandbox").join("\n");
    expect(output).toContain("pnpm infra:aws:state init sandbox");
    expect(output).toContain("bootstrap");
    expect(output).toContain("core");
    expect(output).toContain("apps");
    expect(output).toContain("choose");
  });
});
