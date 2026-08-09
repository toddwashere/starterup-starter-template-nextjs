import { describe, it, expect } from "vitest";
import { formatGithubOutputs, publicUrlOutputs } from "./public-url-outputs";

describe("publicUrlOutputs", () => {
  it("emits the exact key set both workflows consume", () => {
    expect(Object.keys(publicUrlOutputs("example.com", "production"))).toEqual([
      "dashboard",
      "www",
      "api",
      "mcp",
      "auth",
    ]);
  });

  it("matches production hostnames", () => {
    expect(publicUrlOutputs("example.com", "production")).toEqual({
      dashboard: "https://dashboard.example.com",
      www: "https://example.com",
      api: "https://api.example.com",
      mcp: "https://mcp.example.com",
      auth: "https://dashboard.example.com",
    });
  });

  it("matches flat staging hostnames", () => {
    expect(publicUrlOutputs("example.com", "staging")).toEqual({
      dashboard: "https://dashboard-staging.example.com",
      www: "https://www-staging.example.com",
      api: "https://api-staging.example.com",
      mcp: "https://mcp-staging.example.com",
      auth: "https://dashboard-staging.example.com",
    });
  });
});

describe("formatGithubOutputs", () => {
  it("emits key=value lines with a trailing newline", () => {
    expect(formatGithubOutputs({ api: "https://a", www: "https://b" })).toBe(
      "api=https://a\nwww=https://b\n",
    );
  });

  it("rejects a value containing a newline (GITHUB_OUTPUT injection)", () => {
    expect(() => formatGithubOutputs({ api: "https://a\nevil=1" })).toThrow(
      /newline/,
    );
  });
});
