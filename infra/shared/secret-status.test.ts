import { describe, it, expect } from "vitest";
import {
  buildSecretStatusRows,
  classifySecretPayload,
  formatSecretStatusTable,
  placeholderSecretsNeedingValues,
  secretIdFromArg,
} from "./secret-status";
import { SECRET_CATALOG, placeholderSecrets } from "./secret-catalog";

describe("classifySecretPayload", () => {
  it("treats null/undefined as missing", () => {
    expect(classifySecretPayload(null)).toBe("missing");
    expect(classifySecretPayload(undefined)).toBe("missing");
  });

  it("treats whitespace-only as empty", () => {
    expect(classifySecretPayload("")).toBe("empty");
    expect(classifySecretPayload("  \n")).toBe("empty");
  });

  it("treats non-empty strings as set", () => {
    expect(classifySecretPayload("sk_test_abc")).toBe("set");
  });
});

describe("buildSecretStatusRows", () => {
  it("maps catalog entries to status rows", () => {
    const rows = buildSecretStatusRows(SECRET_CATALOG, {
      "stripe-secret-key": "sk_live_x",
      "database-url": null,
    });
    const stripe = rows.find((r) => r.id === "stripe-secret-key");
    const db = rows.find((r) => r.id === "database-url");
    expect(stripe?.status).toBe("set");
    expect(db?.status).toBe("missing");
  });
});

describe("placeholderSecretsNeedingValues", () => {
  it("lists unset placeholder secrets only", () => {
    const rows = buildSecretStatusRows(placeholderSecrets(), {
      "stripe-secret-key": "",
      "resend-api-key": "re_123",
    });
    const needing = placeholderSecretsNeedingValues(rows);
    expect(needing.map((r) => r.id)).toContain("stripe-secret-key");
    expect(needing.map((r) => r.id)).not.toContain("resend-api-key");
  });
});

describe("formatSecretStatusTable", () => {
  it("renders a readable table", () => {
    const table = formatSecretStatusTable([
      {
        id: "stripe-secret-key",
        envVar: "STRIPE_SECRET_KEY",
        generation: "placeholder",
        readers: ["dashboard"],
        status: "empty",
      },
    ]);
    expect(table).toContain("stripe-secret-key");
    expect(table).toContain("empty");
  });
});

describe("secretIdFromArg", () => {
  it("resolves by secret id or env var name", () => {
    expect(secretIdFromArg(SECRET_CATALOG, "stripe-secret-key")?.id).toBe("stripe-secret-key");
    expect(secretIdFromArg(SECRET_CATALOG, "STRIPE_SECRET_KEY")?.id).toBe("stripe-secret-key");
    expect(secretIdFromArg(SECRET_CATALOG, "nope")).toBeUndefined();
  });
});
