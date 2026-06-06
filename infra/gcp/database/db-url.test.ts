import { describe, it, expect } from "vitest";
import { composeDatabaseUrl } from "./db-url";

const base = {
  user: "starter",
  password: "s3cret",
  dbName: "starter",
  privateIp: "",
  connectionName: "test-project:us-central1:starter-db-sandbox",
};

describe("composeDatabaseUrl", () => {
  it("uses the Cloud SQL unix-socket form when privateIp is empty (public)", () => {
    expect(composeDatabaseUrl(base)).toBe(
      "postgresql://starter:s3cret@/starter?host=/cloudsql/test-project:us-central1:starter-db-sandbox",
    );
  });

  it("uses the private-IP TCP form when privateIp is set (private)", () => {
    expect(composeDatabaseUrl({ ...base, privateIp: "10.20.0.5" })).toBe(
      "postgresql://starter:s3cret@10.20.0.5/starter",
    );
  });

  it("private branch ignores connectionName", () => {
    const url = composeDatabaseUrl({ ...base, privateIp: "10.0.0.9", connectionName: "ignored" });
    expect(url).not.toContain("cloudsql");
    expect(url).toContain("@10.0.0.9/");
  });

  it("public branch ignores privateIp value (empty only)", () => {
    const url = composeDatabaseUrl(base);
    expect(url).toContain("host=/cloudsql/");
    expect(url).not.toMatch(/@\d/);
  });

  it("interpolates user, password, and db into the right positions", () => {
    const url = composeDatabaseUrl({
      user: "alice",
      password: "pw",
      dbName: "appdb",
      privateIp: "10.0.0.1",
      connectionName: "p:r:i",
    });
    expect(url).toBe("postgresql://alice:pw@10.0.0.1/appdb");
  });
});
