import { beforeEach, describe, expect, it, vi } from "vitest";

const TEST_SECRET = "b".repeat(32);

vi.mock("../../keys", () => ({
  keys: vi.fn(() => ({
    CAMPAIGN_UNSUBSCRIBE_SECRET: TEST_SECRET,
    NEXT_PUBLIC_WWW_URL: "https://www.example.com",
  })),
}));

vi.mock("@workspace/database", () => ({
  prisma: {
    contact: { findFirst: vi.fn() },
    organization: { findFirst: vi.fn() },
    emailEnrollment: { findFirst: vi.fn() },
  },
}));

vi.mock("@workspace/email/marketing/send-marketing-email", () => ({
  sendMarketingEmail: vi.fn().mockResolvedValue({ providerMessageId: "msg_1" }),
}));

vi.mock("@workspace/contacts", () => ({
  createContactInteraction: vi.fn(),
}));

vi.mock("@workspace/worker-queue", () => ({
  enqueue: vi.fn(),
}));

vi.mock("../data-models/email-step-send-repo", () => ({
  getEmailStepSendById: vi.fn(),
  markEmailStepSendSent: vi.fn(),
  markEmailStepSendSkipped: vi.fn(),
  createEmailStepSend: vi.fn(),
  findEmailStepSendByIdempotencyKey: vi.fn(),
}));

vi.mock("../data-models/email-enrollment-repo", () => ({
  updateEmailEnrollment: vi.fn(),
}));

vi.mock("../data-models/email-preference-repo", () => ({
  isContactSubscribed: vi.fn(),
  isSequenceOptedOut: vi.fn(),
}));

import { prisma } from "@workspace/database";
import { sendMarketingEmail } from "@workspace/email/marketing/send-marketing-email";
import { enqueue } from "@workspace/worker-queue";
import {
  getEmailStepSendById,
  markEmailStepSendSkipped,
  markEmailStepSendSent,
  createEmailStepSend,
  findEmailStepSendByIdempotencyKey,
} from "../data-models/email-step-send-repo";
import { updateEmailEnrollment } from "../data-models/email-enrollment-repo";
import { isContactSubscribed } from "../data-models/email-preference-repo";
import { executeStepSend, scheduleNextStep } from "./step-send-service";

const baseStepSend = {
  id: "esend_1",
  status: "pending",
  step: {
    id: "estep_1",
    sortOrder: 0,
    templateKey: "nurture-intro",
    subjectTemplate: "Hi {{firstName}}",
    templateProps: {
      bodyIntro: "Hello",
      ctaUrl: "https://example.com",
      ctaLabel: "Go",
    },
    delayMinutes: 60,
  },
  enrollment: {
    id: "eenrl_1",
    organizationId: "org_1",
    contactId: "contact_1",
    enrolledById: "user_1",
    status: "active",
    currentStepIndex: 0,
    campaignRun: null,
    sequence: {
      id: "eseq_1",
      name: "Welcome",
      slug: "welcome",
      kind: "campaign",
      status: "active",
      steps: [
        {
          id: "estep_1",
          sortOrder: 0,
          delayMinutes: 0,
          templateKey: "nurture-intro",
          subjectTemplate: "Hi",
          templateProps: {},
        },
        {
          id: "estep_2",
          sortOrder: 1,
          delayMinutes: 60,
          templateKey: "nurture-intro",
          subjectTemplate: "Follow up",
          templateProps: {},
        },
      ],
    },
  },
};

describe("executeStepSend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getEmailStepSendById).mockResolvedValue(baseStepSend as never);
    vi.mocked(prisma.contact.findFirst).mockResolvedValue({
      id: "contact_1",
      primaryEmail: "jane@example.com",
      displayName: "Jane",
      firstName: "Jane",
      lastName: "Doe",
      companyName: null,
    } as never);
    vi.mocked(prisma.organization.findFirst).mockResolvedValue({ name: "Acme" } as never);
    vi.mocked(isContactSubscribed).mockResolvedValue(true);
  });

  it("exits enrollment when contact unsubscribed mid-sequence", async () => {
    vi.mocked(isContactSubscribed).mockResolvedValue(false);

    await executeStepSend("esend_1");

    expect(markEmailStepSendSkipped).toHaveBeenCalledWith("esend_1", "unsubscribed_all");
    expect(updateEmailEnrollment).toHaveBeenCalledWith("eenrl_1", "org_1", {
      status: "exited",
      exitReason: "unsubscribed_all",
      completedAt: expect.any(Date),
      nextSendAt: null,
    });
    expect(sendMarketingEmail).not.toHaveBeenCalled();
  });

  it("sends email and schedules next step", async () => {
    await executeStepSend("esend_1");

    expect(sendMarketingEmail).toHaveBeenCalledOnce();
    expect(markEmailStepSendSent).toHaveBeenCalledWith("esend_1", "msg_1");
    expect(updateEmailEnrollment).toHaveBeenCalledWith("eenrl_1", "org_1", {
      currentStepIndex: 1,
    });
    expect(enqueue).toHaveBeenCalledWith("campaign.schedule-next-step", {
      enrollmentId: "eenrl_1",
    });
  });

  it("is idempotent when step send is not pending", async () => {
    vi.mocked(getEmailStepSendById).mockResolvedValue({
      ...baseStepSend,
      status: "sent",
    } as never);

    await executeStepSend("esend_1");

    expect(sendMarketingEmail).not.toHaveBeenCalled();
  });
});

describe("scheduleNextStep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.emailEnrollment.findFirst).mockResolvedValue({
      id: "eenrl_1",
      organizationId: "org_1",
      status: "active",
      currentStepIndex: 0,
      sequence: {
        steps: [{ id: "estep_2", delayMinutes: 60 }],
      },
    } as never);
    vi.mocked(findEmailStepSendByIdempotencyKey).mockResolvedValue(null);
    vi.mocked(createEmailStepSend).mockResolvedValue({ id: "esend_2" } as never);
  });

  it("enqueues send-step with delayMs from step delay", async () => {
    await scheduleNextStep("eenrl_1");

    expect(enqueue).toHaveBeenCalledWith(
      "campaign.send-step",
      { stepSendId: "esend_2" },
      {
        idempotencyKey: "eenrl_1:estep_2",
        delayMs: 60 * 60_000,
      },
    );
  });
});
