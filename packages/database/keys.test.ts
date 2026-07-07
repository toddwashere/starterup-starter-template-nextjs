import { describe, it, expect, afterEach } from "vitest";
import { keys } from "./keys";

const OLD = process.env;
afterEach(() => { process.env = { ...OLD }; });

describe("database keys", () => {
  it("defaults DIRECT_URL to DATABASE_URL when unset", () => {
    process.env.DATABASE_URL = "postgresql://u:p@host:6543/db";
    delete process.env.DIRECT_URL;
    const k = keys();
    expect(k.DIRECT_URL).toBe("postgresql://u:p@host:6543/db");
  });

  it("uses DIRECT_URL when provided", () => {
    process.env.DATABASE_URL = "postgresql://u:p@pooler:6543/db";
    process.env.DIRECT_URL = "postgresql://u:p@direct:5432/db";
    const k = keys();
    expect(k.DIRECT_URL).toBe("postgresql://u:p@direct:5432/db");
  });

  it("rejects a missing DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => keys()).toThrow();
  });

  it("parses a valid postgres URL", () => {
    process.env.DATABASE_URL = "postgresql://postgres:postgres@localhost:5432/starter_dev";
    expect(keys().DATABASE_URL).toContain("starter_dev");
  });

  it("rejects a malformed DATABASE_URL", () => {
    process.env.DATABASE_URL = "not-a-url";
    expect(() => keys()).toThrow();
  });
});
