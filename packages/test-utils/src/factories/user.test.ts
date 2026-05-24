import { describe, it, expect } from "vitest";
import { buildUser } from "./user";

describe("buildUser", () => {
  it("generates distinct emails by default", () => {
    const a = buildUser();
    const b = buildUser();
    expect(a.email).not.toBe(b.email);
  });
});
