import { afterEach, describe, expect, it, vi } from "vitest";

describe("public MCP env", () => {
  afterEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it("parses and normalizes NEXT_PUBLIC_MCP_URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_MCP_URL", "http://localhost:4003/");
    const { getPublicMcpUrl, getPublicMcpEndpoint, getPublicMcpListenPort } =
      await import("./public-mcp.js");
    expect(getPublicMcpUrl()).toBe("http://localhost:4003");
    expect(getPublicMcpEndpoint()).toBe("http://localhost:4003/mcp");
    expect(getPublicMcpListenPort()).toBe(4003);
  });

  it("prefers PORT over the public URL port for listen", async () => {
    vi.stubEnv("NEXT_PUBLIC_MCP_URL", "https://mcp.example.com");
    vi.stubEnv("PORT", "4003");
    const { getPublicMcpListenPort } = await import("./public-mcp.js");
    expect(getPublicMcpListenPort()).toBe(4003);
  });

  it("throws when NEXT_PUBLIC_MCP_URL is missing", async () => {
    delete process.env.NEXT_PUBLIC_MCP_URL;
    const { getPublicMcpUrl } = await import("./public-mcp.js");
    expect(() => getPublicMcpUrl()).toThrow(/NEXT_PUBLIC_MCP_URL is required/);
  });

  it("throws when NEXT_PUBLIC_MCP_URL is not a URL", async () => {
    vi.stubEnv("NEXT_PUBLIC_MCP_URL", "not-a-url");
    const { getPublicMcpUrl } = await import("./public-mcp.js");
    expect(() => getPublicMcpUrl()).toThrow(/must be a valid URL/);
  });
});
