import { describe, expect, it } from "vitest";
import {
  CURRENT_FILTER_VERSION,
  ContactSegmentFilterSchemaV2,
} from "./segment-schemas";

describe("segment filter schema v2", () => {
  it("CURRENT_FILTER_VERSION is 2", () => {
    expect(CURRENT_FILTER_VERSION).toBe(2);
  });

  it("accepts contactIds", () => {
    const parsed = ContactSegmentFilterSchemaV2.parse({
      search: "x",
      contactIds: ["a", "b"],
    });
    expect(parsed.contactIds).toEqual(["a", "b"]);
  });

  it("rejects unknown keys", () => {
    expect(() => ContactSegmentFilterSchemaV2.parse({ bogus: 1 })).toThrow();
  });
});
