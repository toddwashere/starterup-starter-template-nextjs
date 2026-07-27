import { describe, expect, it } from "vitest";
import {
  buildSystemStatus,
  isEnvSet,
  isPlaceholderSecret,
  type ProbeResults,
} from "./system-status";

describe("isEnvSet", () => {
  it("is true only when the env value is non-empty after trim", () => {
    expect(isEnvSet({ FOO: "x" }, "FOO")).toBe(true);
    expect(isEnvSet({ FOO: "  " }, "FOO")).toBe(false);
    expect(isEnvSet({}, "FOO")).toBe(false);
  });
});

describe("isPlaceholderSecret", () => {
  it("detects common template placeholders", () => {
    expect(isPlaceholderSecret("sk_test_xxxxxxxx")).toBe(true);
    expect(isPlaceholderSecret("whsec_xxxxxxxx")).toBe(true);
    expect(isPlaceholderSecret("change-me-generate-with-openssl-rand-base64-32")).toBe(
      true,
    );
    expect(isPlaceholderSecret("sk_test_51RealLookingKey")).toBe(false);
  });
});

describe("buildSystemStatus", () => {
  const probesOk: ProbeResults = {
    databaseOk: true,
    databaseLatencyMs: 12,
    authOk: true,
    authLatencyMs: 18,
  };

  it("always includes database and auth checks", () => {
    const result = buildSystemStatus(probesOk, {});
    expect(result.checks.map((c) => c.id)).toEqual(["database", "auth"]);
    expect(result.status).toBe("ready");
  });

  it("includes database latency on the ready check", () => {
    const result = buildSystemStatus(probesOk, {});
    expect(result.checks.find((c) => c.id === "database")).toMatchObject({
      state: "ready",
      latencyMs: 12,
      message: "Database connection is healthy (12 ms).",
    });
  });

  it("omits latency when the probe did not measure it", () => {
    const result = buildSystemStatus(
      {
        databaseOk: true,
        databaseLatencyMs: null,
        authOk: true,
        authLatencyMs: null,
      },
      {},
    );
    const database = result.checks.find((c) => c.id === "database");
    expect(database?.latencyMs).toBeUndefined();
    expect(database?.message).toBe("Database connection is healthy.");
    const auth = result.checks.find((c) => c.id === "auth");
    expect(auth?.latencyMs).toBeUndefined();
    expect(auth?.message).toBe("Auth URL is reachable.");
  });

  it("includes auth latency on the ready check", () => {
    const result = buildSystemStatus(probesOk, {});
    expect(result.checks.find((c) => c.id === "auth")).toMatchObject({
      state: "ready",
      latencyMs: 18,
      message: "Auth URL is reachable (18 ms).",
    });
  });

  it("marks overall not-ready when database is down", () => {
    const result = buildSystemStatus(
      {
        databaseOk: false,
        databaseLatencyMs: 40,
        authOk: true,
        authLatencyMs: 10,
      },
      {},
    );
    expect(result.status).toBe("not-ready");
    expect(result.checks.find((c) => c.id === "database")).toMatchObject({
      state: "not-ready",
      latencyMs: 40,
    });
  });

  it("marks overall not-ready when auth is unreachable", () => {
    const result = buildSystemStatus(
      {
        databaseOk: true,
        databaseLatencyMs: 8,
        authOk: false,
        authLatencyMs: 25,
      },
      {},
    );
    expect(result.status).toBe("not-ready");
    expect(result.checks.find((c) => c.id === "auth")).toMatchObject({
      state: "not-ready",
      latencyMs: 25,
    });
  });

  it("omits email when no email env vars are set", () => {
    const result = buildSystemStatus(probesOk, {});
    expect(result.checks.find((c) => c.id === "email")).toBeUndefined();
  });

  it("includes email as configured when any email env is set", () => {
    const result = buildSystemStatus(probesOk, {
      RESEND_API_KEY: "re_test_key",
    });
    expect(result.checks.find((c) => c.id === "email")).toMatchObject({
      state: "configured",
    });
  });

  it("includes email when only EMAIL_FROM is set", () => {
    const result = buildSystemStatus(probesOk, {
      EMAIL_FROM: "App <noreply@example.com>",
    });
    expect(result.checks.find((c) => c.id === "email")?.state).toBe(
      "configured",
    );
  });

  it("omits queue when no queue env vars are set", () => {
    const result = buildSystemStatus(probesOk, {});
    expect(result.checks.find((c) => c.id === "queue")).toBeUndefined();
  });

  it("includes queue with adapter name when queue env is set", () => {
    const result = buildSystemStatus(probesOk, {
      WORKER_QUEUE_ADAPTER: "sqs",
      SQS_QUEUE_URL: "https://sqs.us-east-2.amazonaws.com/123/q",
    });
    expect(result.checks.find((c) => c.id === "queue")).toMatchObject({
      state: "configured",
      message: expect.stringContaining("sqs"),
    });
  });

  it("omits stripe when keys are missing or placeholders", () => {
    expect(
      buildSystemStatus(probesOk, {}).checks.find((c) => c.id === "billing"),
    ).toBeUndefined();
    expect(
      buildSystemStatus(probesOk, {
        STRIPE_SECRET_KEY: "sk_test_xxxxxxxx",
        STRIPE_WEBHOOK_SECRET: "whsec_xxxxxxxx",
      }).checks.find((c) => c.id === "billing"),
    ).toBeUndefined();
  });

  it("includes billing when a non-placeholder stripe key is set", () => {
    const result = buildSystemStatus(probesOk, {
      STRIPE_SECRET_KEY: "sk_test_51RealLookingKey",
    });
    expect(result.checks.find((c) => c.id === "billing")).toMatchObject({
      state: "configured",
    });
  });

  it("omits observability when unset and includes when set", () => {
    expect(
      buildSystemStatus(probesOk, {}).checks.find((c) => c.id === "observability"),
    ).toBeUndefined();
    const result = buildSystemStatus(probesOk, {
      SENTRY_DSN: "https://abc@o.ingest.sentry.io/1",
    });
    expect(result.checks.find((c) => c.id === "observability")).toMatchObject({
      state: "enabled",
    });
  });
});
