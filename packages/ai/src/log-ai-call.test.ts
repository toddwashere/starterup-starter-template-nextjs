import { afterEach, describe, expect, it, vi } from "vitest";
import { logAiCall } from "./log-ai-call";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("logAiCall()", () => {
  it("logs a structured line including the providerModel string", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logAiCall({
      functionId: "ai.chat",
      providerModel: "openrouter:anthropic/claude-sonnet-4",
      userId: "user_1",
      orgId: "org_1",
    });

    expect(spy).toHaveBeenCalledOnce();
    const [tag, payload] = spy.mock.calls[0] as [string, string];
    expect(tag).toBe("[ai]");
    expect(JSON.parse(payload)).toEqual({
      functionId: "ai.chat",
      providerModel: "openrouter:anthropic/claude-sonnet-4",
      userId: "user_1",
      orgId: "org_1",
    });
  });

  it("omits optional fields that are not provided", () => {
    const spy = vi.spyOn(console, "info").mockImplementation(() => {});

    logAiCall({
      functionId: "ai.example",
      providerModel: "openai:gpt-4o-mini",
    });

    const payload = (spy.mock.calls[0] as [string, string])[1];
    const parsed = JSON.parse(payload);
    expect(parsed).toEqual({
      functionId: "ai.example",
      providerModel: "openai:gpt-4o-mini",
    });
    expect("userId" in parsed).toBe(false);
  });
});
