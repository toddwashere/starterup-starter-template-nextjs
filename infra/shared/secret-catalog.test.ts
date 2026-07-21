import { describe, it, expect } from "vitest";
import {
  SECRET_CATALOG,
  secretsForApp,
  generatedSecrets,
  placeholderSecrets,
} from "./secret-catalog";

const APP_NAMES = ["dashboard", "www", "public-api", "public-mcp", "workers"];

describe("SECRET_CATALOG", () => {
  it("references only real app names in readers", () => {
    for (const s of SECRET_CATALOG) {
      for (const r of s.readers) {
        expect(APP_NAMES).toContain(r);
      }
    }
  });

  it("has unique secret ids and env vars", () => {
    const ids = SECRET_CATALOG.map((s) => s.id);
    const envs = SECRET_CATALOG.map((s) => s.envVar);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(envs).size).toBe(envs.length);
  });
});

describe("generated vs placeholder partition", () => {
  it("partitions the catalog with no overlap and full coverage", () => {
    const gen = generatedSecrets().map((s) => s.id);
    const ph = placeholderSecrets().map((s) => s.id);
    expect(gen.filter((id) => ph.includes(id))).toEqual([]);
    expect([...gen, ...ph].sort()).toEqual(SECRET_CATALOG.map((s) => s.id).sort());
  });

  it("classifies database-url and better-auth-secret as generated", () => {
    const gen = generatedSecrets().map((s) => s.id);
    expect(gen).toContain("database-url");
    expect(gen).toContain("better-auth-secret");
  });

  it("classifies stripe-secret-key as placeholder", () => {
    const ph = placeholderSecrets().map((s) => s.id);
    expect(ph).toContain("stripe-secret-key");
  });
});

describe("secretsForApp", () => {
  it("gives www exactly the two secrets its /email/* routes need", () => {
    // www's boot path needs nothing, but its /email/* routes load
    // @workspace/campaigns (module-scope Prisma) and verify the unsubscribe
    // token, so it reads database-url and campaign-unsubscribe-secret -- and
    // nothing else.
    expect(
      secretsForApp("www")
        .map((s) => s.id)
        .sort(),
    ).toEqual(["campaign-unsubscribe-secret", "database-url"]);
  });

  it("includes database-url and better-auth-secret for dashboard", () => {
    const ids = secretsForApp("dashboard").map((s) => s.id);
    expect(ids).toContain("database-url");
    expect(ids).toContain("better-auth-secret");
  });
});
