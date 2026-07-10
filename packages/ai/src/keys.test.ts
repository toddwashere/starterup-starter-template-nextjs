import { afterEach, describe, expect, it, vi } from "vitest";
import { keys } from "../keys";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("keys() — secrets only (no routing / generation vars)", () => {
  it("treats an empty provider key as undefined", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "");
    expect(keys().OPENROUTER_API_KEY).toBeUndefined();
  });

  it("parses a provider key when it is set", () => {
    vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test");
    expect(keys().OPENROUTER_API_KEY).toBe("sk-or-test");
  });

  it("keeps the optional Langfuse keys", () => {
    vi.stubEnv("LANGFUSE_PUBLIC_KEY", "pk-lf-test");
    expect(keys().LANGFUSE_PUBLIC_KEY).toBe("pk-lf-test");
  });

  it("reads the Bedrock AWS region and role arn when set", () => {
    vi.stubEnv("AWS_REGION", "us-east-1");
    vi.stubEnv("AWS_ROLE_ARN", "arn:aws:iam::123456789012:role/vercel");
    const config = keys();
    expect(config.AWS_REGION).toBe("us-east-1");
    expect(config.AWS_ROLE_ARN).toBe("arn:aws:iam::123456789012:role/vercel");
  });

  it("treats an empty AWS_ROLE_ARN as undefined (AWS default credential chain)", () => {
    vi.stubEnv("AWS_ROLE_ARN", "");
    expect(keys().AWS_ROLE_ARN).toBeUndefined();
  });

  it("no longer exposes model routing or generation env vars", () => {
    const config = keys() as Record<string, unknown>;
    expect(config.AI_AGENT_MAX_STEPS).toBeUndefined();
    expect(config.AI_PROVIDER).toBeUndefined();
    expect(config.AI_MODEL).toBeUndefined();
    expect(config.AI_TEMPERATURE).toBeUndefined();
    expect(config.AI_MAX_OUTPUT_TOKENS).toBeUndefined();
  });
});
