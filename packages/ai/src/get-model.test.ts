import { afterEach, describe, expect, it, vi } from "vitest";
import { getModel } from "./get-model";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("getModel()", () => {
  describe("when AI_PROVIDER is unset or empty", () => {
    it("throws when AI_PROVIDER is empty string", () => {
      vi.stubEnv("AI_PROVIDER", "");
      expect(() => getModel()).toThrow(/not configured/i);
    });

    it("throws when AI_PROVIDER is not set at all", () => {
      // Ensure env var is absent
      vi.stubEnv("AI_PROVIDER", "");
      expect(() => getModel()).toThrow(/not configured/i);
    });
  });

  describe("openrouter provider", () => {
    it("returns a defined model when OPENROUTER_API_KEY and AI_MODEL are set", () => {
      vi.stubEnv("AI_PROVIDER", "openrouter");
      vi.stubEnv("OPENROUTER_API_KEY", "sk-or-test-key");
      vi.stubEnv("AI_MODEL", "anthropic/claude-sonnet-4");
      expect(getModel()).toBeDefined();
    });

    it("throws a readable error naming OPENROUTER_API_KEY when it is missing", () => {
      vi.stubEnv("AI_PROVIDER", "openrouter");
      vi.stubEnv("OPENROUTER_API_KEY", "");
      expect(() => getModel()).toThrow(/OPENROUTER_API_KEY/);
    });
  });

  describe("openai provider", () => {
    it("returns a defined model when OPENAI_API_KEY is set", () => {
      vi.stubEnv("AI_PROVIDER", "openai");
      vi.stubEnv("OPENAI_API_KEY", "sk-test-key");
      expect(getModel()).toBeDefined();
    });

    it("throws a readable error naming OPENAI_API_KEY when it is missing", () => {
      vi.stubEnv("AI_PROVIDER", "openai");
      vi.stubEnv("OPENAI_API_KEY", "");
      expect(() => getModel()).toThrow(/OPENAI_API_KEY/);
    });
  });

  describe("anthropic provider", () => {
    it("returns a defined model when ANTHROPIC_API_KEY is set", () => {
      vi.stubEnv("AI_PROVIDER", "anthropic");
      vi.stubEnv("ANTHROPIC_API_KEY", "sk-ant-test-key");
      expect(getModel()).toBeDefined();
    });

    it("throws a readable error naming ANTHROPIC_API_KEY when it is missing", () => {
      vi.stubEnv("AI_PROVIDER", "anthropic");
      vi.stubEnv("ANTHROPIC_API_KEY", "");
      expect(() => getModel()).toThrow(/ANTHROPIC_API_KEY/);
    });
  });

  describe("ollama provider", () => {
    it("returns a defined model without requiring an explicit OLLAMA_BASE_URL", () => {
      vi.stubEnv("AI_PROVIDER", "ollama");
      vi.stubEnv("AI_MODEL", "llama3");
      // Deliberately NOT setting OLLAMA_BASE_URL — should default to localhost
      expect(getModel()).toBeDefined();
    });

    it("uses a provided OLLAMA_BASE_URL when set", () => {
      vi.stubEnv("AI_PROVIDER", "ollama");
      vi.stubEnv("AI_MODEL", "llama3");
      vi.stubEnv("OLLAMA_BASE_URL", "http://my-ollama-host:11434/v1");
      expect(getModel()).toBeDefined();
    });
  });

  describe("openai-compatible provider", () => {
    it("throws a readable error naming AI_OPENAI_COMPAT_BASE_URL when it is missing", () => {
      vi.stubEnv("AI_PROVIDER", "openai-compatible");
      vi.stubEnv("AI_OPENAI_COMPAT_BASE_URL", "");
      expect(() => getModel()).toThrow(/AI_OPENAI_COMPAT_BASE_URL/);
    });

    it("returns a defined model when AI_OPENAI_COMPAT_BASE_URL is set", () => {
      vi.stubEnv("AI_PROVIDER", "openai-compatible");
      vi.stubEnv("AI_OPENAI_COMPAT_BASE_URL", "http://localhost:1234/v1");
      expect(getModel()).toBeDefined();
    });
  });
});
