import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/campaigns", () => ({
  scheduleNextStep: vi.fn(),
}));

import { scheduleNextStep } from "@workspace/campaigns";
import { handleCampaignScheduleNextStep } from "./schedule-next-step";

describe("handleCampaignScheduleNextStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to scheduleNextStep", async () => {
    await handleCampaignScheduleNextStep({ enrollmentId: "eenrl_1" });
    expect(scheduleNextStep).toHaveBeenCalledWith("eenrl_1");
  });
});
