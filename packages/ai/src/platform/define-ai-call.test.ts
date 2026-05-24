import { describe, expect, it } from "vitest";
import { z } from "zod";
import { defineAiCall, loadCallPrompt } from "./define-ai-call";

// A URL that points at a (notional) module inside the fixture folder. defineAiCall
// only uses its directory, so the file itself need not exist — prompt.md does.
const fixtureModuleUrl = new URL(
  "./__fixtures__/sample-call/sample-call.ts",
  import.meta.url,
).href;

describe("defineAiCall()", () => {
  const call = defineAiCall({
    id: "sample-call",
    importMetaUrl: fixtureModuleUrl,
    prompt: "./prompt.md",
    preset: "assistant",
    mode: "stream",
    variables: z.object({ name: z.string() }),
    presetOverrides: { temperature: 0.1 },
  });

  it("resolves the call folder from the caller's import.meta.url", () => {
    expect(call.dir.replace(/\\/g, "/")).toMatch(
      /platform\/__fixtures__\/sample-call$/,
    );
  });

  it("normalizes the prompt path to a bare filename", () => {
    expect(call.promptFile).toBe("prompt.md");
  });

  it("carries id, preset, mode, variables, and overrides through", () => {
    expect(call.id).toBe("sample-call");
    expect(call.preset).toBe("assistant");
    expect(call.mode).toBe("stream");
    expect(call.presetOverrides).toEqual({ temperature: 0.1 });
    expect(call.variables.safeParse({ name: "x" }).success).toBe(true);
    expect(call.variables.safeParse({}).success).toBe(false);
  });
});

describe("loadCallPrompt()", () => {
  it("reads prompt.md from the resolved call folder", () => {
    const call = defineAiCall({
      id: "sample-call",
      importMetaUrl: fixtureModuleUrl,
      prompt: "./prompt.md",
      preset: "assistant",
      mode: "stream",
      variables: z.object({ name: z.string() }),
    });

    expect(loadCallPrompt(call).trim()).toBe("Hello {{name}}");
  });
});
