import { expect, it, describe } from "vitest";
import { buildPoolerDatabaseUrl } from "./pooler-endpoint";

describe("buildPoolerDatabaseUrl", () => {
  it("uses the custom verified TLS hostname", () => {
    expect(
      buildPoolerDatabaseUrl({
        username: "app_db_user",
        password: "encoded-password",
        hostname: "db.sandbox.aws.example.com",
        database: "app_db",
      }),
    ).toBe(
      "postgresql://app_db_user:encoded-password@db.sandbox.aws.example.com:6432/app_db?sslmode=verify-full",
    );
  });

  it("never uses the generated NLB hostname in the URL", () => {
    const url = buildPoolerDatabaseUrl({
      username: "app_db_user",
      password: "test-pass",
      hostname: "db.sandbox.aws.example.com",
      database: "app_db",
    });

    // Assert the URL uses the custom hostname, not an NLB DNS name
    expect(url).toContain("@db.sandbox.aws.example.com:");
    expect(url).not.toContain("elb.amazonaws.com");
    expect(url).not.toContain(".amazonaws.com");
  });
});
