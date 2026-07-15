import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { buildCertificateExporterCode } from "./pooler-tls";

describe("pooler certificate exporter bundle", () => {
  it("loads as CommonJS and exports the configured Lambda handler", () => {
    const code = buildCertificateExporterCode();
    const lambdaModule: { exports: Record<string, unknown> } = { exports: {} };
    const evaluateBundle = new Function("module", "exports", "require", code);

    evaluateBundle(lambdaModule, lambdaModule.exports, createRequire(import.meta.url));

    expect(typeof lambdaModule.exports.handler).toBe("function");
  });
});
