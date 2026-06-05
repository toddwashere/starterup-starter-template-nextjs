import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/contacts", () => ({
  createContactInteraction: vi.fn(),
}));

vi.mock("@workspace/database", () => ({
  prisma: {},
}));

vi.mock("../data-models/email-step-send-repo", () => ({
  findEmailStepSendByProviderMessageId: vi.fn(),
  markEmailStepSendDelivered: vi.fn(),
  markEmailStepSendFailed: vi.fn(),
}));

vi.mock("../data-models/email-delivery-event-repo", () => ({
  appendEmailDeliveryEvent: vi.fn(),
}));

vi.mock("../data-models/email-preference-repo", () => ({
  setContactEmailPreference: vi.fn(),
}));

vi.mock("../data-models/email-enrollment-repo", () => ({
  exitActiveEnrollmentsForContact: vi.fn(),
}));

import {
  findEmailStepSendByProviderMessageId,
  markEmailStepSendDelivered,
  markEmailStepSendFailed,
} from "../data-models/email-step-send-repo";
import { setContactEmailPreference } from "../data-models/email-preference-repo";
import { exitActiveEnrollmentsForContact } from "../data-models/email-enrollment-repo";
import { applyDeliveryEvent } from "./delivery-event-service";

describe("delivery-event-service", () => {
  beforeEach(() => vi.clearAllMocks());

  const enrollment = {
    contactId: "contact_1",
    organizationId: "org_1",
  };

  it("marks delivered on delivered event", async () => {
    vi.mocked(findEmailStepSendByProviderMessageId).mockResolvedValue({
      id: "esend_1",
      enrollment,
    } as never);

    await applyDeliveryEvent("resend", {
      type: "delivered",
      providerMessageId: "msg_1",
      occurredAt: new Date().toISOString(),
    });

    expect(markEmailStepSendDelivered).toHaveBeenCalledWith("esend_1");
  });

  it("hard bounce suppresses contact and exits enrollments", async () => {
    vi.mocked(findEmailStepSendByProviderMessageId).mockResolvedValue({
      id: "esend_1",
      enrollment,
    } as never);

    await applyDeliveryEvent("resend", {
      type: "bounced",
      providerMessageId: "msg_1",
      occurredAt: new Date().toISOString(),
      bounceClass: "hard",
    });

    expect(markEmailStepSendFailed).toHaveBeenCalledWith("esend_1", "hard bounce");
    expect(setContactEmailPreference).toHaveBeenCalledWith(
      "contact_1",
      "org_1",
      "unsubscribed",
    );
    expect(exitActiveEnrollmentsForContact).toHaveBeenCalledWith(
      "contact_1",
      "org_1",
      "bounced",
    );
  });

  it("soft bounce logs only", async () => {
    vi.mocked(findEmailStepSendByProviderMessageId).mockResolvedValue({
      id: "esend_1",
      enrollment,
    } as never);

    await applyDeliveryEvent("resend", {
      type: "bounced",
      providerMessageId: "msg_1",
      occurredAt: new Date().toISOString(),
      bounceClass: "soft",
    });

    expect(markEmailStepSendFailed).toHaveBeenCalledWith("esend_1", "soft bounce");
    expect(setContactEmailPreference).not.toHaveBeenCalled();
    expect(exitActiveEnrollmentsForContact).not.toHaveBeenCalled();
  });
});
