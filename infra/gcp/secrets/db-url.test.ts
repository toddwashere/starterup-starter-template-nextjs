import { describe, it, expect } from "vitest";
import { composeDatabaseUrl } from "./db-url";

describe("composeDatabaseUrl", () => {
  it("uses the private-IP form when privateIp is non-empty", () => {
    const url = composeDatabaseUrl({
      user: "starter",
      password: "pw123",
      dbName: "starter",
      privateIp: "10.30.0.5",
      connectionName: "proj:us-central1:starter-db-production",
    });
    expect(url).toBe("postgresql://starter:pw123@10.30.0.5/starter");
  });

  it("uses the Cloud SQL socket form when privateIp is empty", () => {
    const url = composeDatabaseUrl({
      user: "starter",
      password: "pw123",
      dbName: "starter",
      privateIp: "",
      connectionName: "proj:us-central1:starter-db-sandbox",
    });
    expect(url).toBe(
      "postgresql://starter:pw123@/starter?host=/cloudsql/proj:us-central1:starter-db-sandbox",
    );
  });

  it("passes credentials through unchanged (caller supplies safe values)", () => {
    const url = composeDatabaseUrl({
      user: "starter",
      password: "abcDEF123456",
      dbName: "starter",
      privateIp: "10.30.0.5",
      connectionName: "ignored",
    });
    expect(url).toContain(":abcDEF123456@");
  });
});
