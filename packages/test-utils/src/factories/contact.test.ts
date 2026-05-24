import { describe, it, expect } from "vitest";
import { buildContact } from "./contact";

describe("buildContact", () => {
  it("returns a person contact with required fields", () => {
    const contact = buildContact({ organizationId: "org_1" });
    expect(contact.organizationId).toBe("org_1");
    expect(contact.kind).toBe("person");
    expect(contact.id).toMatch(/^contact_/);
    expect(contact.displayName).toBeTruthy();
  });

  it("merges overrides", () => {
    const contact = buildContact({
      organizationId: "org_1",
      displayName: "Override Name",
    });
    expect(contact.displayName).toBe("Override Name");
  });
});
