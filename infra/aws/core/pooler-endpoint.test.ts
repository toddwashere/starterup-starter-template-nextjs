import { expect, it } from "vitest";
import { buildPoolerDatabaseUrl } from "./pooler-endpoint";

it("uses the custom verified TLS hostname", () => {
  expect(
    buildPoolerDatabaseUrl({
      username: "starter",
      password: "encoded-password",
      hostname: "db.sandbox.aws.example.com",
      database: "starter",
    }),
  ).toBe(
    "postgresql://starter:encoded-password@db.sandbox.aws.example.com:6432/starter?sslmode=verify-full",
  );
});
