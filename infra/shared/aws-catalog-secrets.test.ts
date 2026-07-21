import { describe, expect, it } from "vitest";
import { SECRET_CATALOG } from "./secret-catalog";
import { awsCatalogAppSecrets, awsCatalogPlaceholderSeed } from "./aws-catalog-secrets";

describe("awsCatalogAppSecrets", () => {
  it("includes every catalog secret except database-url", () => {
    const ids = awsCatalogAppSecrets()
      .map((s) => s.id)
      .sort();
    const expected = SECRET_CATALOG.filter((s) => s.id !== "database-url")
      .map((s) => s.id)
      .sort();
    expect(ids).toEqual(expected);
    expect(ids).not.toContain("database-url");
  });
});

describe("awsCatalogPlaceholderSeed", () => {
  it("returns a non-empty plain string for each AWS catalog secret", () => {
    for (const secret of awsCatalogAppSecrets()) {
      const seed = awsCatalogPlaceholderSeed(secret.id);
      expect(seed.length).toBeGreaterThan(0);
      expect(() => JSON.parse(seed)).toThrow();
    }
  });

  it("throws for unknown ids", () => {
    expect(() => awsCatalogPlaceholderSeed("not-a-secret")).toThrow(/unknown/i);
  });
});
