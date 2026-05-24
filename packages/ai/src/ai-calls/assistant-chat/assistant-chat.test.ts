import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("ai", () => ({
  streamText: vi.fn(() => ({ __stream: true })),
  generateText: vi.fn(),
  stepCountIs: vi.fn((n: number) => ({ __stepCount: n })),
}));
vi.mock("../../platform/get-model", () => ({
  getModel: vi.fn(() => ({ __model: true })),
}));

import { streamText } from "ai";
import { loadCallPrompt } from "../../platform/define-ai-call";
import { extractTemplateVars } from "../../platform/extract-template-vars";
import { getModel } from "../../platform/get-model";
import { askAssistantChat, call, variables } from "./assistant-chat";

const mockedStreamText = streamText as ReturnType<typeof vi.fn>;
const mockedGetModel = getModel as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("LANGFUSE_PUBLIC_KEY", "");
  vi.stubEnv("LANGFUSE_SECRET_KEY", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("assistant-chat call", () => {
  it("is a stream-mode call on the assistant preset", () => {
    expect(call.id).toBe("assistant-chat");
    expect(call.preset).toBe("assistant");
    expect(call.mode).toBe("stream");
  });

  it("prompt placeholders match the Zod variable schema keys", () => {
    const placeholders = extractTemplateVars(loadCallPrompt(call));
    expect(placeholders.sort()).toEqual(Object.keys(variables.shape).sort());
  });
});

describe("askAssistantChat()", () => {
  it("renders orgName into the system prompt passed to the SDK", async () => {
    await askAssistantChat({
      messages: [{ role: "user", content: "hi" }],
      tools: {},
      variables: { orgName: "Acme Corp" },
      context: { userId: "u1", orgId: "o1" },
    });

    expect(mockedStreamText).toHaveBeenCalledOnce();
    const arg = mockedStreamText.mock.lastCall![0] as { system: string };
    expect(arg.system).toContain("Acme Corp");
  });

  it("includes the tool summary section when provided", async () => {
    await askAssistantChat({
      messages: [],
      tools: {},
      variables: { orgName: "Acme Corp", toolSummary: "- account-info" },
      context: { userId: "u1", orgId: "o1" },
    });

    const arg = mockedStreamText.mock.lastCall![0] as { system: string };
    expect(arg.system).toContain("- account-info");
  });

  it("forwards a configured providerModel override to getModel", async () => {
    vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test");

    await askAssistantChat({
      messages: [],
      tools: {},
      variables: { orgName: "Acme Corp" },
      overrides: { providerModel: "anthropic:claude-sonnet-4-20250514" },
      context: { userId: "u1", orgId: "o1" },
    });

    expect(mockedGetModel).toHaveBeenCalledWith({
      providerModel: "anthropic:claude-sonnet-4-20250514",
    });
  });

  it("rejects an invalid orgName before calling the SDK", async () => {
    await expect(
      askAssistantChat({
        messages: [],
        tools: {},
        variables: { orgName: "" },
        context: { userId: "u1", orgId: "o1" },
      }),
    ).rejects.toThrow();
    expect(mockedStreamText).not.toHaveBeenCalled();
  });
});
