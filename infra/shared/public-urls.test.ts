import { describe, it, expect } from "vitest";
import {
  buildPublicUrlEnv,
  resolveEnvApexDomain,
  resolveLbHosts,
} from "./public-urls";

const DOMAINS = {
  base: "example.com",
  stagingPrefix: "staging",
  sandboxPrefix: "sandbox",
};

describe("resolveEnvApexDomain", () => {
  it("returns base for production", () => {
    expect(resolveEnvApexDomain(DOMAINS, "production")).toBe("example.com");
  });

  it("prefixes staging and sandbox", () => {
    expect(resolveEnvApexDomain(DOMAINS, "staging")).toBe("staging.example.com");
    expect(resolveEnvApexDomain(DOMAINS, "sandbox")).toBe("sandbox.example.com");
  });

  it("returns empty when base is unset", () => {
    expect(resolveEnvApexDomain({ ...DOMAINS, base: "" }, "production")).toBe("");
  });
});

describe("resolveLbHosts", () => {
  it("maps standard subdomains for production apex", () => {
    expect(resolveLbHosts("example.com")).toEqual([
      { host: "app.example.com", app: "dashboard" },
      { host: "api.example.com", app: "public-api" },
      { host: "mcp.example.com", app: "public-mcp" },
      { host: "example.com", app: "www" },
    ]);
  });

  it("maps prefixed staging apex", () => {
    expect(resolveLbHosts("staging.example.com")).toEqual([
      { host: "app.staging.example.com", app: "dashboard" },
      { host: "api.staging.example.com", app: "public-api" },
      { host: "mcp.staging.example.com", app: "public-mcp" },
      { host: "staging.example.com", app: "www" },
    ]);
  });
});

describe("buildPublicUrlEnv", () => {
  it("builds HTTPS URLs from apex domain", () => {
    expect(buildPublicUrlEnv("staging.example.com")).toEqual({
      NEXT_PUBLIC_DASHBOARD_URL: "https://app.staging.example.com",
      NEXT_PUBLIC_WWW_URL: "https://staging.example.com",
      NEXT_PUBLIC_API_URL: "https://api.staging.example.com",
      NEXT_PUBLIC_MCP_URL: "https://mcp.staging.example.com",
      NEXT_PUBLIC_BETTER_AUTH_URL: "https://app.staging.example.com",
      BETTER_AUTH_URL: "https://app.staging.example.com",
    });
  });
});
