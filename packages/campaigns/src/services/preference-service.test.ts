import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SECRET = "c".repeat(32);

vi.mock("../../keys", () => ({
  keys: vi.fn(() => ({
    CAMPAIGN_UNSUBSCRIBE_SECRET: TEST_SECRET,
    NEXT_PUBLIC_WWW_URL: "http://localhost:4001",
  })),
}));

vi.mock("@workspace/database", () => ({
  prisma: {
    organization: { findFirst: vi.fn() },
  },
}));

vi.mock("@workspace/contacts", () => ({
  createContactInteraction: vi.fn(),
}));

vi.mock("../data-models/email-preference-repo", () => ({
  setContactEmailPreference: vi.fn(),
  optOutOfSequence: vi.fn(),
}));

vi.mock("../data-models/email-enrollment-repo", () => ({
  exitActiveEnrollmentsForContact: vi.fn(),
}));

import { setContactEmailPreference, optOutOfSequence } from "../data-models/email-preference-repo";
import { exitActiveEnrollmentsForContact } from "../data-models/email-enrollment-repo";
import { signMarketingToken } from "../marketing-token";
import {
  unsubscribeAll,
  unsubscribeFromSequence,
  unsubscribeFromToken,
} from "./preference-service";

describe("preference-service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("unsubscribe all exits all enrollments", async () => {
    await unsubscribeAll("contact_1", "org_1");

    expect(setContactEmailPreference).toHaveBeenCalledWith(
      "contact_1",
      "org_1",
      "unsubscribed",
    );
    expect(exitActiveEnrollmentsForContact).toHaveBeenCalledWith(
      "contact_1",
      "org_1",
      "unsubscribed_all",
    );
  });

  it("sequence opt-out exits one sequence", async () => {
    await unsubscribeFromSequence("contact_1", "eseq_1", "org_1");

    expect(optOutOfSequence).toHaveBeenCalledWith("contact_1", "eseq_1");
    expect(exitActiveEnrollmentsForContact).toHaveBeenCalledWith(
      "contact_1",
      "org_1",
      "unsubscribed_sequence",
      "eseq_1",
    );
  });

  it("rejects tampered tokens", async () => {
    const token = signMarketingToken({
      contactId: "contact_1",
      organizationId: "org_1",
      scope: "all",
    });
    const [body] = token.split(".");
    await expect(unsubscribeFromToken(`${body}.bad-signature`)).rejects.toThrow(
      "Invalid token signature",
    );
  });
});
