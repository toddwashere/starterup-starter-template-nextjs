import { describe, it, expect, afterEach } from "vitest";
import { keys } from "./keys";

describe("database keys", () => {
  const original = process.env.DATABASE_URL;

  afterEach(() => {
    if (original === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = original;
  });

  it("parses a valid postgres URL", () => {
    process.env.DATABASE_URL =
      "postgresql://postgres:postgres@localhost:5432/starter_dev";
    expect(keys().DATABASE_URL).toContain("starter_dev");
  });

  it("rejects a missing DATABASE_URL", () => {
    delete process.env.DATABASE_URL;
    expect(() => keys()).toThrow();
  });

  it("rejects a malformed DATABASE_URL", () => {
    process.env.DATABASE_URL = "not-a-url";
    expect(() => keys()).toThrow();
  });
});
