import { describe, expect, it } from "vitest";
import { authClient, invalidateOrganizationList } from "./auth-client";

describe("invalidateOrganizationList", () => {
  it("toggles the $listOrg atom so subscribers refetch", () => {
    const atom = authClient.$store.atoms.$listOrg;
    expect(atom).toBeDefined();
    if (!atom) return;
    const before = atom.get();
    invalidateOrganizationList();
    expect(atom.get()).toBe(!before);
  });
});
