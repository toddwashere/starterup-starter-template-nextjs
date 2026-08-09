import { describe, it, expect } from "vitest";
import { buildEnv } from "./env-manifest";

describe("buildEnv - local profile", () => {
  it("returns localhost URLs for all services", () => {
    const env = buildEnv("local");
    expect(env.NEXT_PUBLIC_DASHBOARD_URL).toBe("http://localhost:4000");
    expect(env.NEXT_PUBLIC_WWW_URL).toBe("http://localhost:4001");
    expect(env.NEXT_PUBLIC_API_URL).toBe("http://localhost:4002");
    expect(env.NEXT_PUBLIC_MCP_URL).toBe("http://localhost:4003");
  });

  it("sets BETTER_AUTH_URL and NEXT_PUBLIC_BETTER_AUTH_URL to dashboard localhost", () => {
    const env = buildEnv("local");
    expect(env.BETTER_AUTH_URL).toBe("http://localhost:4000");
    expect(env.NEXT_PUBLIC_BETTER_AUTH_URL).toBe("http://localhost:4000");
  });

  it("sets REDIS_URL to localhost redis", () => {
    const env = buildEnv("local");
    expect(env.REDIS_URL).toBe("redis://localhost:6379");
  });

  it("sets WORKER_QUEUE_ADAPTER to bullmq", () => {
    const env = buildEnv("local");
    expect(env.WORKER_QUEUE_ADAPTER).toBe("bullmq");
  });

  it("sets DATABASE_URL to local postgres", () => {
    const env = buildEnv("local");
    expect(env.DATABASE_URL).toBe(
      "postgresql://postgres:postgres@localhost:5432/app_db",
    );
  });

  it("respects redisUrl override", () => {
    const env = buildEnv("local", { redisUrl: "redis://custom:6380" });
    expect(env.REDIS_URL).toBe("redis://custom:6380");
  });

  it("respects databaseUrl override", () => {
    const env = buildEnv("local", { databaseUrl: "postgresql://custom/db" });
    expect(env.DATABASE_URL).toBe("postgresql://custom/db");
  });
});

describe("buildEnv - vercel profile", () => {
  const BASE = "example.com";

  it("produces https subdomain URLs for dashboard", () => {
    const env = buildEnv("vercel", { baseDomain: BASE });
    expect(env.NEXT_PUBLIC_DASHBOARD_URL).toBe("https://dashboard.example.com");
  });

  it("produces root domain URL for www", () => {
    const env = buildEnv("vercel", { baseDomain: BASE });
    expect(env.NEXT_PUBLIC_WWW_URL).toBe("https://example.com");
  });

  it("sets BETTER_AUTH_URL to dashboard subdomain", () => {
    const env = buildEnv("vercel", { baseDomain: BASE });
    expect(env.BETTER_AUTH_URL).toBe("https://dashboard.example.com");
    expect(env.NEXT_PUBLIC_BETTER_AUTH_URL).toBe("https://dashboard.example.com");
  });

  it("sets WORKER_QUEUE_ADAPTER to bullmq", () => {
    const env = buildEnv("vercel", { baseDomain: BASE });
    expect(env.WORKER_QUEUE_ADAPTER).toBe("bullmq");
  });

  it("throws when baseDomain is omitted", () => {
    expect(() => buildEnv("vercel")).toThrowError(
      /baseDomain is required for profile "vercel"/,
    );
  });
});

describe("buildEnv - gcp profile", () => {
  const BASE = "example.com";

  it("sets WORKER_QUEUE_ADAPTER to pubsub", () => {
    const env = buildEnv("gcp", { baseDomain: BASE });
    expect(env.WORKER_QUEUE_ADAPTER).toBe("pubsub");
  });

  it("does not include REDIS_URL", () => {
    const env = buildEnv("gcp", { baseDomain: BASE });
    expect(env).not.toHaveProperty("REDIS_URL");
  });

  it("throws when baseDomain is omitted", () => {
    expect(() => buildEnv("gcp")).toThrowError(
      /baseDomain is required for profile "gcp"/,
    );
  });
});

describe("buildEnv - render profile", () => {
  it("sets WORKER_QUEUE_ADAPTER to bullmq", () => {
    const env = buildEnv("render", { baseDomain: "example.com" });
    expect(env.WORKER_QUEUE_ADAPTER).toBe("bullmq");
  });

  it("sets empty REDIS_URL (to be supplied via secrets)", () => {
    const env = buildEnv("render", { baseDomain: "example.com" });
    expect(env.REDIS_URL).toBe("");
  });
});

describe("buildEnv - aws/azure cloud profiles", () => {
  it("aws uses sqs adapter and no REDIS_URL", () => {
    const env = buildEnv("aws", { baseDomain: "example.com" });
    expect(env.WORKER_QUEUE_ADAPTER).toBe("sqs");
    expect(env).not.toHaveProperty("REDIS_URL");
  });

  it("azure uses servicebus adapter and no REDIS_URL", () => {
    const env = buildEnv("azure", { baseDomain: "example.com" });
    expect(env.WORKER_QUEUE_ADAPTER).toBe("servicebus");
    expect(env).not.toHaveProperty("REDIS_URL");
  });
});
