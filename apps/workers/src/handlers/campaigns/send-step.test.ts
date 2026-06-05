import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/campaigns", () => ({
  executeStepSend: vi.fn(),
}));

import { executeStepSend } from "@workspace/campaigns";
import { handleCampaignSendStep } from "./send-step";

describe("handleCampaignSendStep", () => {
  beforeEach(() => vi.clearAllMocks());

  it("delegates to executeStepSend", async () => {
    await handleCampaignSendStep({ stepSendId: "esend_1" });
    expect(executeStepSend).toHaveBeenCalledWith("esend_1");
  });
});
