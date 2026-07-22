import { describe, expect, it } from "vitest";
import { buildAppRuntimeEnvironmentVariables } from "./aws-runtime-env";

describe("buildAppRuntimeEnvironmentVariables", () => {
  const runtimeEnv = {
    shared: { EMAIL_FROM: "App <a@example.com>" },
    byApp: { "public-mcp": { EXTRA: "1" } },
  };

  it("merges infra, derived URLs, shared, and byApp", () => {
    const env = buildAppRuntimeEnvironmentVariables({
      apexDomain: "staging.example.com",
      runtimeEnv,
      appName: "public-mcp",
      infraVars: { PORT: "4003", HOSTNAME: "0.0.0.0" },
    });
    expect(env.PORT).toBe("4003");
    expect(env.NEXT_PUBLIC_DASHBOARD_URL).toBe("https://app.staging.example.com");
    expect(env.NEXT_PUBLIC_WWW_URL).toBe("https://staging.example.com");
    expect(env.EMAIL_FROM).toBe("App <a@example.com>");
    expect(env.EXTRA).toBe("1");
  });

  it("lets publicUrlOverrides win over derived URLs", () => {
    const env = buildAppRuntimeEnvironmentVariables({
      apexDomain: "staging.example.com",
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

  it("uses loopback bootstrap when apex is empty", () => {
    const env = buildAppRuntimeEnvironmentVariables({
      apexDomain: "",
      runtimeEnv: { shared: {} },
      appName: "dashboard",
      infraVars: {},
    });
    expect(env.BETTER_AUTH_URL).toBe("http://127.0.0.1:4000");
  });
});
