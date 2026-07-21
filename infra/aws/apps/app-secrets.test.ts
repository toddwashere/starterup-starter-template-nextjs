import { describe, expect, it } from "vitest";
import {
  buildAppRunnerRuntimeSecrets,
  appRunnerInstanceSecretArns,
  resolveSecretArn,
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

describe("resolveSecretArn", () => {
  it("special-cases database-url, which is not in catalogSecretArns", () => {
    expect(resolveSecretArn("database-url", arns)).toBe("arn:db-url");
  });

  // Binding constraint: a missing ARN must fail the deploy loudly. Returning
  // undefined would silently ship an App Runner service (or Lambda) whose env
  // var points at nothing. index.ts calls this same function, so this covers
  // the shipped path, not a parallel copy of the rule.
  it("throws rather than returning undefined for an unknown secret", () => {
    expect(() => resolveSecretArn("nope", arns)).toThrow(/nope/);
  });

  it("throws when a known catalog id is absent from the bag", () => {
    const empty = { ...arns, catalogSecretArns: {} };
    expect(() => resolveSecretArn("stripe-secret-key", empty)).toThrow(
      /Missing catalogSecretArns\[stripe-secret-key\]/,
    );
  });
});

describe("buildAppRunnerRuntimeSecrets", () => {
  it("maps catalog env vars to shared ARNs for dashboard", () => {
    const secrets = buildAppRunnerRuntimeSecrets("dashboard", arns);
    expect(secrets.DATABASE_URL).toBe("arn:db-url");
    expect(secrets.STRIPE_SECRET_KEY).toBe("arn:stripe");
    expect(secrets.BETTER_AUTH_SECRET).toBe("arn:auth");
    // billing keys() requires the secret key and webhook secret together, so
    // every catalog reader of one is a reader of the other.
    expect(secrets.STRIPE_WEBHOOK_SECRET).toBe("arn:whsec");
  });

  it("shares the same stripe ARN with public-api", () => {
    const dash = buildAppRunnerRuntimeSecrets("dashboard", arns);
    const api = buildAppRunnerRuntimeSecrets("public-api", arns);
    expect(dash.STRIPE_SECRET_KEY).toBe(api.STRIPE_SECRET_KEY);
  });

  it("gives www only its /email/* route secrets", () => {
    expect(buildAppRunnerRuntimeSecrets("www", arns)).toEqual({
      DATABASE_URL: "arn:db-url",
      CAMPAIGN_UNSUBSCRIBE_SECRET: "arn:unsub",
    });
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
