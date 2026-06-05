import { vi, describe, it, expect, beforeEach } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    contactEmailPreference: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    contactEmailSequenceOptOut: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
  },
}));

import { prisma } from "@workspace/database";
import {
  isContactSubscribed,
  setContactEmailPreference,
  optOutOfSequence,
} from "./email-preference-repo";

beforeEach(() => vi.clearAllMocks());

describe("isContactSubscribed", () => {
  it("returns true when no preference exists", async () => {
    vi.mocked(prisma.contactEmailPreference.findUnique).mockResolvedValue(null as never);
    await expect(isContactSubscribed("contact_1", "org_1")).resolves.toBe(true);
  });

  it("returns false when unsubscribed", async () => {
    vi.mocked(prisma.contactEmailPreference.findUnique).mockResolvedValue({
      status: "unsubscribed",
    } as never);
    await expect(isContactSubscribed("contact_1", "org_1")).resolves.toBe(false);
  });
});

describe("setContactEmailPreference", () => {
  it("upserts with epref prefix on create", async () => {
    vi.mocked(prisma.contactEmailPreference.upsert).mockResolvedValue({} as never);
    await setContactEmailPreference("contact_1", "org_1", "unsubscribed");
    const call = vi.mocked(prisma.contactEmailPreference.upsert).mock.calls[0]?.[0];
    expect(call?.create.id).toMatch(/^epref_/);
    expect(call?.create.status).toBe("unsubscribed");
  });
});

describe("optOutOfSequence", () => {
  it("upserts sequence opt-out", async () => {
    vi.mocked(prisma.contactEmailSequenceOptOut.upsert).mockResolvedValue({} as never);
    await optOutOfSequence("contact_1", "eseq_1");
    expect(prisma.contactEmailSequenceOptOut.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { contactId_sequenceId: { contactId: "contact_1", sequenceId: "eseq_1" } },
      }),
    );
  });
});
