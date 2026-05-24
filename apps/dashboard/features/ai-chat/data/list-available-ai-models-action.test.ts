import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/auth/guards", () => ({
  requireUser: vi.fn().mockResolvedValue({
    user: { id: "user_1" },
    session: { activeOrganizationId: "org_1" },
  }),
}));

// Repos pull in Prisma; mock them so importing the actions module is DB-free.
vi.mock("@workspace/ai/data-models/ai-thread-repo", () => ({
  getOrCreateActiveAiThread: vi.fn(),
}));

vi.mock("@workspace/ai/data-models/ai-message-repo", () => ({
  listAiMessagesForThread: vi.fn(),
  updateAiMessageFeedback: vi.fn(),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

import { listAvailableAiModelsAction } from "./ai-chat-actions";

/** Reset all AI credential env vars to empty, then apply overrides. */
function configureEnv(overrides: Record<string, string> = {}): void {
  for (const name of [
    "OPENROUTER_API_KEY",
    "OPENAI_API_KEY",
    "ANTHROPIC_API_KEY",
    "OLLAMA_BASE_URL",
    "AI_OPENAI_COMPAT_BASE_URL",
    "AI_OPENAI_COMPAT_API_KEY",
  ]) {
    vi.stubEnv(name, "");
  }
  for (const [name, value] of Object.entries(overrides)) {
    vi.stubEnv(name, value);
  }
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllEnvs());

describe("listAvailableAiModelsAction", () => {
  it("returns only configured providers and the preset default", async () => {
    configureEnv({ OPENROUTER_API_KEY: "sk-or-test" });

    const result = await listAvailableAiModelsAction();

    expect(result.success).toBe(true);
    if (!result.success) return;

    const values = result.data.models.map((m) => m.value);
    expect(values).toContain("openrouter:anthropic/claude-sonnet-4");
    expect(values).not.toContain("anthropic:claude-sonnet-4-20250514");
    expect(result.data.defaultValue).toBe(
      "openrouter:anthropic/claude-sonnet-4",
    );
  });

  it("falls back to the ollama default when no API keys are configured", async () => {
    configureEnv();

    const result = await listAvailableAiModelsAction();

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.defaultValue).toBe("ollama:llama3.2");
  });
});
