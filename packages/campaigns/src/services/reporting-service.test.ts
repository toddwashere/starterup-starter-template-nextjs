import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../data-models/email-sequence-repo", () => ({
  getEmailSequenceById: vi.fn(),
}));

vi.mock("../data-models/email-enrollment-repo", () => ({
  countEnrollmentsByStatus: vi.fn(),
}));

vi.mock("../data-models/email-step-send-repo", () => ({
  countStepSendsByStep: vi.fn(),
}));

vi.mock("../data-models/email-link-click-repo", () => ({
  countLinkClicksByStepForSequence: vi.fn(),
}));

import { getEmailSequenceById } from "../data-models/email-sequence-repo";
import { countEnrollmentsByStatus } from "../data-models/email-enrollment-repo";
import { countStepSendsByStep } from "../data-models/email-step-send-repo";
import { countLinkClicksByStepForSequence } from "../data-models/email-link-click-repo";
import { getSequenceReportingStats } from "./reporting-service";

describe("reporting-service", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns enrollment status aggregates and per-step click counts", async () => {
    vi.mocked(getEmailSequenceById).mockResolvedValue({
      id: "eseq_1",
      steps: [{ id: "estep_1", sortOrder: 0 }],
    } as never);
    vi.mocked(countEnrollmentsByStatus).mockResolvedValue({
      active: 2,
      completed: 5,
      exited: 1,
    });
    vi.mocked(countStepSendsByStep).mockResolvedValue([
      { stepId: "estep_1", status: "sent", _count: { _all: 3 } },
      { stepId: "estep_1", status: "delivered", _count: { _all: 2 } },
    ] as never);
    vi.mocked(countLinkClicksByStepForSequence).mockResolvedValue({
      estep_1: 4,
    });

    const stats = await getSequenceReportingStats("eseq_1", "org_1");

    expect(stats.enrollmentCounts).toEqual({ active: 2, completed: 5, exited: 1 });
    expect(stats.perStep[0]).toMatchObject({
      stepId: "estep_1",
      sends: 5,
      delivered: 5,
      clicks: 4,
    });
  });
});
