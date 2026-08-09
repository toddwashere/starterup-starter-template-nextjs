import { describe, it, expect } from "vitest";
import {
  buildPublicUrlEnv,
  resolveAppHost,
  resolveDelegatedAppHosts,
  resolveDelegatedPublicHosts,
  resolveEnvApexDomain,
  resolveLbHosts,
  resolveStaticHosts,
} from "./public-urls";

const DOMAINS = {
  base: "example.com",
  stagingPrefix: "staging",
  sandboxPrefix: "sandbox",
};

describe("resolveEnvApexDomain", () => {
  it("returns bare root for production (per-host NS zones)", () => {
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

describe("resolveAppHost", () => {
  it("uses bare labels on the root in production", () => {
    expect(resolveAppHost("api", "production", "example.com")).toBe("api.example.com");
  });

  it("maps the empty label to the bare root in production", () => {
    expect(resolveAppHost("", "production", "example.com")).toBe("example.com");
  });

  it("suffixes the label with the env outside production", () => {
    expect(resolveAppHost("api", "staging", "example.com")).toBe(
      "api-staging.example.com",
    );
    expect(resolveAppHost("api", "sandbox", "example.com")).toBe(
      "api-sandbox.example.com",
    );
  });

  it("names the empty label www outside production", () => {
    expect(resolveAppHost("", "staging", "example.com")).toBe(
      "www-staging.example.com",
    );
  });

  it("returns empty when the root is unset", () => {
    expect(resolveAppHost("api", "production", "")).toBe("");
    expect(resolveAppHost("api", "staging", "   ")).toBe("");
  });
});

describe("resolveDelegatedAppHosts", () => {
  it("lists production subdomain hosts and excludes the bare-apex www", () => {
    expect(resolveDelegatedAppHosts("example.com", "production")).toEqual([
      { host: "dashboard.example.com", app: "dashboard", label: "dashboard" },
      { host: "api.example.com", app: "public-api", label: "api" },
      { host: "mcp.example.com", app: "public-mcp", label: "mcp" },
    ]);
  });

  it("includes www-staging because it is not the bare root", () => {
    expect(resolveDelegatedAppHosts("example.com", "staging")).toEqual([
      {
        host: "dashboard-staging.example.com",
        app: "dashboard",
        label: "dashboard-staging",
      },
      { host: "api-staging.example.com", app: "public-api", label: "api-staging" },
      { host: "mcp-staging.example.com", app: "public-mcp", label: "mcp-staging" },
      { host: "www-staging.example.com", app: "www", label: "www-staging" },
    ]);
  });

  it("returns empty when the root is unset", () => {
    expect(resolveDelegatedAppHosts("", "production")).toEqual([]);
  });
});

describe("resolveLbHosts", () => {
  it("maps bare labels for production, with www on the bare root", () => {
    expect(resolveLbHosts("example.com", "production")).toEqual([
      { host: "dashboard.example.com", app: "dashboard" },
      { host: "api.example.com", app: "public-api" },
      { host: "mcp.example.com", app: "public-mcp" },
      { host: "example.com", app: "www" },
    ]);
  });

  it("maps flat env-suffixed labels for staging", () => {
    expect(resolveLbHosts("example.com", "staging")).toEqual([
      { host: "dashboard-staging.example.com", app: "dashboard" },
      { host: "api-staging.example.com", app: "public-api" },
      { host: "mcp-staging.example.com", app: "public-mcp" },
      { host: "www-staging.example.com", app: "www" },
    ]);
  });

  it("never emits a sub-sub-domain outside production", () => {
    for (const { host } of resolveLbHosts("example.com", "staging")) {
      expect(host.split(".")).toHaveLength(3);
    }
  });
});

describe("resolveStaticHosts", () => {
  it("returns no static hosts in the starter template", () => {
    expect(resolveStaticHosts("example.com", "production")).toEqual([]);
    expect(resolveStaticHosts("example.com", "staging")).toEqual([]);
  });
});

describe("resolveDelegatedPublicHosts", () => {
  it("matches delegated app hosts when there are no static hosts", () => {
    expect(resolveDelegatedPublicHosts("example.com", "production")).toEqual(
      resolveDelegatedAppHosts("example.com", "production"),
    );
  });
});

describe("buildPublicUrlEnv", () => {
  it("builds production HTTPS URLs from the root", () => {
    expect(buildPublicUrlEnv("example.com", "production")).toEqual({
      NEXT_PUBLIC_DASHBOARD_URL: "https://dashboard.example.com",
      NEXT_PUBLIC_WWW_URL: "https://example.com",
      NEXT_PUBLIC_API_URL: "https://api.example.com",
      NEXT_PUBLIC_MCP_URL: "https://mcp.example.com",
      NEXT_PUBLIC_BETTER_AUTH_URL: "https://dashboard.example.com",
      BETTER_AUTH_URL: "https://dashboard.example.com",
    });
  });

  it("builds flat staging HTTPS URLs from the root", () => {
    expect(buildPublicUrlEnv("example.com", "staging")).toEqual({
      NEXT_PUBLIC_DASHBOARD_URL: "https://dashboard-staging.example.com",
      NEXT_PUBLIC_WWW_URL: "https://www-staging.example.com",
      NEXT_PUBLIC_API_URL: "https://api-staging.example.com",
      NEXT_PUBLIC_MCP_URL: "https://mcp-staging.example.com",
      NEXT_PUBLIC_BETTER_AUTH_URL: "https://dashboard-staging.example.com",
      BETTER_AUTH_URL: "https://dashboard-staging.example.com",
    });
  });
});
