import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/database", () => ({
  prisma: {
    contact: { findMany: vi.fn() },
  },
}));

vi.mock("@workspace/contacts", () => ({
  getContactSegmentById: vi.fn(),
  buildSegmentMembershipWhere: vi.fn(() => ({ organizationId: "org_1" })),
  validateSegmentFilters: vi.fn(() => ({})),
}));

vi.mock("@workspace/worker-queue", () => ({
  enqueue: vi.fn(),
}));

vi.mock("../data-models/email-campaign-run-repo", () => ({
  getEmailCampaignRunById: vi.fn(),
  updateEmailCampaignRun: vi.fn(),
}));

vi.mock("../data-models/email-enrollment-repo", () => ({
  createEmailEnrollments: vi.fn(),
  getActiveEnrollmentForContactAndSequence: vi.fn(),
}));

vi.mock("../data-models/email-step-send-repo", () => ({
  createEmailStepSend: vi.fn(),
  findEmailStepSendByIdempotencyKey: vi.fn(),
}));

vi.mock("../data-models/email-preference-repo", () => ({
  isContactSubscribed: vi.fn(),
  isSequenceOptedOut: vi.fn(),
}));

vi.mock("../data-models/email-sequence-repo", () => ({
  getEmailSequenceById: vi.fn(),
}));

import { prisma } from "@workspace/database";
import { getContactSegmentById } from "@workspace/contacts";
import { enqueue } from "@workspace/worker-queue";
import { getEmailCampaignRunById, updateEmailCampaignRun } from "../data-models/email-campaign-run-repo";
import {
  createEmailEnrollments,
  getActiveEnrollmentForContactAndSequence,
} from "../data-models/email-enrollment-repo";
import {
  createEmailStepSend,
  findEmailStepSendByIdempotencyKey,
} from "../data-models/email-step-send-repo";
import { isContactSubscribed, isSequenceOptedOut } from "../data-models/email-preference-repo";
import { getEmailSequenceById } from "../data-models/email-sequence-repo";
import { enrollSegmentSnapshot } from "./enrollment-service";

describe("enrollSegmentSnapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getContactSegmentById).mockResolvedValue({
      id: "cseg_1",
      filters: {},
      filterVersion: 2,
    } as never);
    vi.mocked(getEmailCampaignRunById).mockResolvedValue({
      id: "ecrun_1",
      organizationId: "org_1",
    } as never);
    vi.mocked(getEmailSequenceById).mockResolvedValue({
      id: "eseq_1",
      steps: [{ id: "estep_1", delayMinutes: 0 }],
    } as never);
    vi.mocked(findEmailStepSendByIdempotencyKey).mockResolvedValue(null);
    vi.mocked(createEmailStepSend).mockResolvedValue({ id: "esend_1" } as never);
    vi.mocked(isContactSubscribed).mockResolvedValue(true);
    vi.mocked(isSequenceOptedOut).mockResolvedValue(false);
    vi.mocked(getActiveEnrollmentForContactAndSequence).mockResolvedValue(null);
  });

  it("enrolls eligible contacts only and updates enrolledCount", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      { id: "contact_1", primaryEmail: "a@example.com" },
      { id: "contact_2", primaryEmail: null },
      { id: "contact_3", primaryEmail: "b@example.com" },
    ] as never);

    vi.mocked(isContactSubscribed).mockImplementation(async (contactId) => {
      return contactId !== "contact_3";
    });

    vi.mocked(createEmailEnrollments).mockResolvedValue([
      { id: "eenrl_1", currentStepIndex: 0 },
    ] as never);

    const result = await enrollSegmentSnapshot(
      "org_1",
      "ecrun_1",
      "eseq_1",
      "cseg_1",
      "user_1",
    );

    expect(result.enrolledCount).toBe(1);
    expect(createEmailEnrollments).toHaveBeenCalledWith(
      "org_1",
      expect.arrayContaining([
        expect.objectContaining({ contactId: "contact_1", campaignRunId: "ecrun_1" }),
      ]),
    );
    expect(vi.mocked(createEmailEnrollments).mock.calls[0]?.[1]).toHaveLength(1);
    expect(updateEmailCampaignRun).toHaveBeenCalledWith("ecrun_1", "org_1", {
      enrolledCount: 1,
    });
    expect(enqueue).toHaveBeenCalledWith(
      "campaign.send-step",
      { stepSendId: "esend_1" },
      expect.objectContaining({ idempotencyKey: expect.stringContaining(":") }),
    );
  });

  it("skips contacts with active enrollment", async () => {
    vi.mocked(prisma.contact.findMany).mockResolvedValue([
      { id: "contact_1", primaryEmail: "a@example.com" },
    ] as never);
    vi.mocked(getActiveEnrollmentForContactAndSequence).mockResolvedValue({
      id: "eenrl_existing",
    } as never);
    vi.mocked(createEmailEnrollments).mockResolvedValue([] as never);

    const result = await enrollSegmentSnapshot(
      "org_1",
      "ecrun_1",
      "eseq_1",
      "cseg_1",
      "user_1",
    );

    expect(result.enrolledCount).toBe(0);
    expect(updateEmailCampaignRun).toHaveBeenCalledWith("ecrun_1", "org_1", {
      enrolledCount: 0,
    });
  });
});
