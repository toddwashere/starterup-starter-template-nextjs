import { describe, expect, it } from "vitest";
import {
  assertCookieDomainScoped,
  buildAppRuntimeEnvironmentVariables,
} from "./aws-runtime-env";

describe("buildAppRuntimeEnvironmentVariables", () => {
  const runtimeEnv = {
    shared: { EMAIL_FROM: "App <a@example.com>" },
    byApp: { "public-mcp": { EXTRA: "1" } },
  };

  it("merges infra, derived URLs, shared, and byApp", () => {
    const env = buildAppRuntimeEnvironmentVariables({
      rootDomain: "example.com",
      env: "staging",
      runtimeEnv,
      appName: "public-mcp",
      infraVars: { PORT: "4003", HOSTNAME: "0.0.0.0" },
    });
    expect(env.PORT).toBe("4003");
    expect(env.NEXT_PUBLIC_DASHBOARD_URL).toBe(
      "https://dashboard-staging.example.com",
    );
    expect(env.NEXT_PUBLIC_WWW_URL).toBe("https://www-staging.example.com");
    expect(env.EMAIL_FROM).toBe("App <a@example.com>");
    expect(env.EXTRA).toBe("1");
  });

  it("keeps production on bare labels", () => {
    const env = buildAppRuntimeEnvironmentVariables({
      rootDomain: "example.com",
      env: "production",
      runtimeEnv,
      appName: "dashboard",
      infraVars: {},
    });
    expect(env.NEXT_PUBLIC_DASHBOARD_URL).toBe("https://dashboard.example.com");
    expect(env.NEXT_PUBLIC_WWW_URL).toBe("https://example.com");
  });

  it("lets publicUrlOverrides win over derived URLs", () => {
    const env = buildAppRuntimeEnvironmentVariables({
      rootDomain: "example.com",
      env: "staging",
      runtimeEnv: {
        ...runtimeEnv,
        publicUrlOverrides: {
          NEXT_PUBLIC_DASHBOARD_URL: "https://custom.example.com",
        },
      },
      appName: "dashboard",
      infraVars: {},
    });
    expect(env.NEXT_PUBLIC_DASHBOARD_URL).toBe("https://custom.example.com");
  });

  it("uses loopback bootstrap when the root domain is empty", () => {
    const env = buildAppRuntimeEnvironmentVariables({
      rootDomain: "",
      env: "sandbox",
      runtimeEnv: { shared: {} },
      appName: "dashboard",
      infraVars: {},
    });
    expect(env.BETTER_AUTH_URL).toBe("http://127.0.0.1:4000");
  });
});

describe("assertCookieDomainScoped", () => {
  const ownHosts = ["api-staging.example.com", "dashboard-staging.example.com"];

  it("allows an unset cookie domain", () => {
    expect(() =>
      assertCookieDomainScoped({ cookieDomain: undefined, ownHosts, env: "staging" }),
    ).not.toThrow();
    expect(() =>
      assertCookieDomainScoped({ cookieDomain: "  ", ownHosts, env: "staging" }),
    ).not.toThrow();
  });

  it("allows one of this environment's own hostnames, with or without a leading dot", () => {
    expect(() =>
      assertCookieDomainScoped({
        cookieDomain: "dashboard-staging.example.com",
        ownHosts,
        env: "staging",
      }),
    ).not.toThrow();
    expect(() =>
      assertCookieDomainScoped({
        cookieDomain: ".dashboard-staging.example.com",
        ownHosts,
        env: "staging",
      }),
    ).not.toThrow();
  });

  it("rejects the shared registrable domain", () => {
    expect(() =>
      assertCookieDomainScoped({
        cookieDomain: ".example.com",
        ownHosts,
        env: "staging",
      }),
    ).toThrow(/not one of the staging hostnames/);
  });

  it("rejects another environment's hostname", () => {
    expect(() =>
      assertCookieDomainScoped({
        cookieDomain: "dashboard.example.com",
        ownHosts,
        env: "staging",
      }),
    ).toThrow(/not one of the staging hostnames/);
  });
});

describe("buildAppRuntimeEnvironmentVariables cookie guard", () => {
  it("throws when a shared parent cookie domain is configured", () => {
    expect(() =>
      buildAppRuntimeEnvironmentVariables({
        rootDomain: "example.com",
        env: "staging",
        runtimeEnv: { shared: { WEB_AUTH_COOKIE_DOMAIN: ".example.com" } },
        appName: "public-api",
        infraVars: {},
      }),
    ).toThrow(/not one of the staging hostnames/);
  });

  it("accepts this environment's own host as a cookie domain", () => {
    expect(() =>
      buildAppRuntimeEnvironmentVariables({
        rootDomain: "example.com",
        env: "staging",
        runtimeEnv: {
          shared: { WEB_AUTH_COOKIE_DOMAIN: "dashboard-staging.example.com" },
        },
        appName: "dashboard",
        infraVars: {},
      }),
    ).not.toThrow();
  });

  it("does not run the guard when there is no root domain", () => {
    expect(() =>
      buildAppRuntimeEnvironmentVariables({
        rootDomain: "",
        env: "sandbox",
        runtimeEnv: { shared: { WEB_AUTH_COOKIE_DOMAIN: ".example.com" } },
        appName: "public-api",
        infraVars: {},
      }),
    ).not.toThrow();
  });
});
