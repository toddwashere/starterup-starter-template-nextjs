import { describe, expect, it } from "vitest";
import {
  buildAppRunnerRuntimeSecrets,
  appRunnerInstanceSecretArns,
  workersRuntimeSecretIds,
} from "./app-secrets";

const arns = {
  databaseUrlSecretArn: "arn:db-url",
  directUrlSecretArn: "arn:direct-url",
  catalogSecretArns: {
    "better-auth-secret": "arn:auth",
    "campaign-unsubscribe-secret": "arn:unsub",
    "stripe-secret-key": "arn:stripe",
    "stripe-webhook-secret": "arn:whsec",
    "resend-api-key": "arn:resend",
    "openrouter-api-key": "arn:or",
    "sentry-dsn": "arn:sentry",
  },
};

describe("buildAppRunnerRuntimeSecrets", () => {
  it("maps catalog env vars to shared ARNs for dashboard", () => {
    const secrets = buildAppRunnerRuntimeSecrets("dashboard", arns);
    expect(secrets.DATABASE_URL).toBe("arn:db-url");
    expect(secrets.STRIPE_SECRET_KEY).toBe("arn:stripe");
    expect(secrets.BETTER_AUTH_SECRET).toBe("arn:auth");
    expect(secrets.STRIPE_WEBHOOK_SECRET).toBeUndefined();
  });

  it("shares the same stripe ARN with public-api", () => {
    const dash = buildAppRunnerRuntimeSecrets("dashboard", arns);
    const api = buildAppRunnerRuntimeSecrets("public-api", arns);
    expect(dash.STRIPE_SECRET_KEY).toBe(api.STRIPE_SECRET_KEY);
  });

  it("returns empty map for www", () => {
    expect(buildAppRunnerRuntimeSecrets("www", arns)).toEqual({});
  });
});

describe("appRunnerInstanceSecretArns", () => {
  it("returns explicit DB + all catalog ARNs without wildcards", () => {
    const list = appRunnerInstanceSecretArns(arns);
    expect(list).toContain("arn:db-url");
    expect(list).toContain("arn:direct-url");
    expect(list).toContain("arn:stripe");
    expect(list.some((a) => a.includes("*"))).toBe(false);
  });
});

describe("workersRuntimeSecretIds", () => {
  it("lists workers catalog readers including database-url", () => {
    expect(workersRuntimeSecretIds()).toEqual(
      expect.arrayContaining([
        "database-url",
        "campaign-unsubscribe-secret",
        "resend-api-key",
        "openrouter-api-key",
        "sentry-dsn",
      ]),
    );
  });
});
