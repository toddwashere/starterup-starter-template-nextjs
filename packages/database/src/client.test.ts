import { describe, it, expect } from "vitest";
import { resolvePoolMax } from "./resolve-pool-max";

describe("resolvePoolMax", () => {
  it('returns 5 for "5"', () => {
    expect(resolvePoolMax("5")).toBe(5);
  });

  it("returns 5 when unset (undefined)", () => {
    expect(resolvePoolMax(undefined)).toBe(5);
  });

  it('returns 5 for ""', () => {
    expect(resolvePoolMax("")).toBe(5);
  });

  it('returns 5 for "abc"', () => {
    expect(resolvePoolMax("abc")).toBe(5);
  });

  it('returns 5 for "0"', () => {
    expect(resolvePoolMax("0")).toBe(5);
  });

  it('returns 10 for "10"', () => {
    expect(resolvePoolMax("10")).toBe(10);
  });
});
