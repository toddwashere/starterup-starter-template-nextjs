import { describe, it, expect } from "vitest";
import { cloudRunImageRefs, missingImageRefs } from "./image-preflight";

describe("cloudRunImageRefs", () => {
  it("builds registry paths for every app", () => {
    const refs = cloudRunImageRefs("us-central1-docker.pkg.dev/acme/starter", "latest");
    expect(refs.find((r) => r.app === "dashboard")?.image).toBe(
      "us-central1-docker.pkg.dev/acme/starter/dashboard:latest",
    );
    expect(refs.length).toBe(5);
  });
});

describe("missingImageRefs", () => {
  it("returns refs that fail the exists check", () => {
    const refs = cloudRunImageRefs("reg", "v1");
    const missing = missingImageRefs(refs, (img) => !img.includes("workers"));
    expect(missing.map((r) => r.app)).toContain("workers");
    expect(missing.length).toBe(1);
  });
});
