import { describe, expect, it } from "vitest";
import {
  createId,
  createIdOfLength,
  createIdTemporary,
  isTemporaryId,
} from "./create-id";

describe("createId", () => {
  it("creates an unprefixed cuid when no prefix is provided", () => {
    const id = createId();
    expect(id).toEqual(expect.any(String));
    expect(id).not.toContain("_");
  });

  it("creates a prefixed ID with the requested suffix length", () => {
    const id = createId("contact", 10);
    expect(id).toMatch(/^contact_[a-z0-9]{10}$/);
  });

  it("creates a raw cuid suffix with the requested length", () => {
    expect(createIdOfLength(8)).toMatch(/^[a-z0-9]{8}$/);
  });

  it("accepts ai prefixes", () => {
    expect(createId("aith")).toMatch(/^aith_/);
    expect(createId("aimsg")).toMatch(/^aimsg_/);
  });

  it("detects temporary IDs only when they use the temporary prefix", () => {
    const temporaryId = createIdTemporary();
    expect(temporaryId).toMatch(/^tmp_[a-z0-9]{16}$/);
    expect(isTemporaryId(temporaryId)).toBe(true);
    expect(isTemporaryId("contact_abc123")).toBe(false);
    expect(isTemporaryId("tmp")).toBe(false);
  });
});
