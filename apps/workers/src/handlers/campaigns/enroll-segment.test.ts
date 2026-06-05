import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/campaigns", () => ({
  enrollSegmentSnapshot: vi.fn(),
}));

vi.mock("@workspace/database", () => ({
  prisma: {
    emailCampaignRun: { findFirst: vi.fn() },
  },
}));

import { prisma } from "@workspace/database";
import { enrollSegmentSnapshot } from "@workspace/campaigns";
import { handleCampaignEnrollSegment } from "./enroll-segment";

describe("handleCampaignEnrollSegment", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to enrollSegmentSnapshot with run context", async () => {
    vi.mocked(prisma.emailCampaignRun.findFirst).mockResolvedValue({
      organizationId: "org_1",
      sequenceId: "eseq_1",
      segmentId: "cseg_1",
    } as never);

    await handleCampaignEnrollSegment({ campaignRunId: "ecrun_1" });

    expect(enrollSegmentSnapshot).toHaveBeenCalledWith(
      "org_1",
      "ecrun_1",
      "eseq_1",
      "cseg_1",
      "system",
    );
  });
});
