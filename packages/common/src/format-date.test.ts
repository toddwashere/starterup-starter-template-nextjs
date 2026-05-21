import { describe, expect, it } from "vitest";
import { formatDate } from "./format-date";

describe("formatDate", () => {
  it("formats a Date object as absolute text", () => {
    expect(formatDate(new Date("2026-05-18T12:00:00"))).toBe("May 18, 2026");
  });

  it("formats a date string as absolute text", () => {
    expect(formatDate("2026-01-01T00:00:00")).toBe("January 1, 2026");
  });

  it("formats a timestamp number as absolute text", () => {
    expect(formatDate(new Date("2026-05-18T00:00:00").getTime())).toBe(
      "May 18, 2026",
    );
  });

  it("includes time when includeTime is true", () => {
    const result = formatDate(new Date("2026-05-18T22:49:00"), {
      includeTime: true,
    });
    expect(result).toBe("May 18, 2026, 10:49 PM");
  });

  it("returns 'just now' for less than 1 minute ago", () => {
    const d = new Date(Date.now() - 30_000);
    expect(formatDate(d, { relative: true })).toBe("just now");
  });

  it("returns 'just now' for less than 1 minute in the future", () => {
    const d = new Date(Date.now() + 30_000);
    expect(formatDate(d, { relative: true })).toBe("just now");
  });

  it("returns minutes ago for past within 1 hour", () => {
    const d = new Date(Date.now() - 5 * 60_000);
    expect(formatDate(d, { relative: true })).toBe("5 minutes ago");
  });

  it("returns in X minutes for future within 1 hour", () => {
    const d = new Date(Date.now() + 15 * 60_000);
    expect(formatDate(d, { relative: true })).toBe("in 15 minutes");
  });

  it("returns hours ago for past within 24 hours", () => {
    const d = new Date(Date.now() - 3 * 3_600_000);
    expect(formatDate(d, { relative: true })).toBe("3 hours ago");
  });

  it("returns in X hours for future within 24 hours", () => {
    const d = new Date(Date.now() + 6 * 3_600_000);
    expect(formatDate(d, { relative: true })).toBe("in 6 hours");
  });

  it("returns days ago for past beyond 24 hours", () => {
    const d = new Date(Date.now() - 3 * 86_400_000);
    expect(formatDate(d, { relative: true })).toBe("3 days ago");
  });

  it("returns in X days for future beyond 24 hours", () => {
    const d = new Date(Date.now() + 2 * 86_400_000);
    expect(formatDate(d, { relative: true })).toBe("in 2 days");
  });
});
