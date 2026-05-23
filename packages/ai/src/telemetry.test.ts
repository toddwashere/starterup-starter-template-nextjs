import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildTelemetryOptions } from "./telemetry";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("buildTelemetryOptions()", () => {
  describe("without Langfuse keys", () => {
    it("returns isEnabled: false when both keys are missing", () => {
      vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
      vi.stubEnv("LANGFUSE_SECRET_KEY", "");

      const result = buildTelemetryOptions({ functionId: "x" });

      expect(result.experimental_telemetry.isEnabled).toBe(false);
    });

    it("returns isEnabled: false when only public key is set", () => {
      vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
      vi.stubEnv("LANGFUSE_SECRET_KEY", "");

      const result = buildTelemetryOptions({ functionId: "x" });

      expect(result.experimental_telemetry.isEnabled).toBe(false);
    });

    it("returns isEnabled: false when only secret key is set", () => {
      vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
      vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test");

      const result = buildTelemetryOptions({ functionId: "x" });

      expect(result.experimental_telemetry.isEnabled).toBe(false);
    });

    it("does not include functionId or metadata when disabled", () => {
      vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
      vi.stubEnv("LANGFUSE_SECRET_KEY", "");

      const result = buildTelemetryOptions({
        functionId: "x",
        userId: "u-1",
      });

      expect(result.experimental_telemetry.functionId).toBeUndefined();
      expect(result.experimental_telemetry.metadata).toBeUndefined();
    });
  });

  describe("with both Langfuse keys set", () => {
    beforeEach(() => {
      vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
      vi.stubEnv("LANGFUSE_SECRET_KEY", "sk-lf-test");
    });

    it("returns isEnabled: true", () => {
      const result = buildTelemetryOptions({ functionId: "x" });
      expect(result.experimental_telemetry.isEnabled).toBe(true);
    });

    it("forwards functionId", () => {
      const result = buildTelemetryOptions({ functionId: "my-fn" });
      expect(result.experimental_telemetry.functionId).toBe("my-fn");
    });

    it("includes userId, orgId, sessionId when provided", () => {
      const result = buildTelemetryOptions({
        functionId: "x",
        userId: "user-123",
        orgId: "org-456",
        sessionId: "sess-789",
      });

      const { metadata } = result.experimental_telemetry;
      expect(metadata?.userId).toBe("user-123");
      expect(metadata?.orgId).toBe("org-456");
      expect(metadata?.sessionId).toBe("sess-789");
    });

    it("omits userId, orgId, sessionId when undefined", () => {
      const result = buildTelemetryOptions({ functionId: "x" });

      const { metadata } = result.experimental_telemetry;
      expect(metadata).toBeDefined();
      expect(Object.keys(metadata ?? {})).not.toContain("userId");
      expect(Object.keys(metadata ?? {})).not.toContain("orgId");
      expect(Object.keys(metadata ?? {})).not.toContain("sessionId");
    });

    it("includes langfuseTraceId when provided", () => {
      const result = buildTelemetryOptions({
        functionId: "x",
        langfuseTraceId: "trace-abc",
      });

      expect(result.experimental_telemetry.metadata?.langfuseTraceId).toBe(
        "trace-abc",
      );
    });

    it("omits langfuseTraceId when not provided", () => {
      const result = buildTelemetryOptions({ functionId: "x" });

      expect(
        Object.keys(result.experimental_telemetry.metadata ?? {}),
      ).not.toContain("langfuseTraceId");
    });
  });
});
