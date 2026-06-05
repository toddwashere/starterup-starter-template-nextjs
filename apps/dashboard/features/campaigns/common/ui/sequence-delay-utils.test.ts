import { describe, expect, it } from "vitest";
import { delayDaysToMinutes, delayMinutesToDays } from "./sequence-delay-utils";

describe("delay day helpers", () => {
  it("stores selected days as minutes", () => {
    expect(delayDaysToMinutes(0)).toBe(0);
    expect(delayDaysToMinutes(3)).toBe(4320);
  });

  it("maps saved minutes back to whole days", () => {
    expect(delayMinutesToDays(0)).toBe(0);
    expect(delayMinutesToDays(1440)).toBe(1);
    expect(delayMinutesToDays(10080)).toBe(7);
  });
});
