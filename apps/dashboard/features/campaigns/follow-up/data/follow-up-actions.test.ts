import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";

vi.mock("@workspace/auth/guards", () => ({
  requireOrgPermissionWithActiveOrg: vi.fn().mockResolvedValue({
    session: { user: { id: "user_1", email: "user@example.com", name: "Test User" } },
    activeOrganizationId: "org_1",
  }),
}));

vi.mock("@workspace/campaigns", () => ({
  listSequences: vi.fn(),
  getSequence: vi.fn(),
  getSequenceStep: vi.fn(),
  createSequence: vi.fn(),
  updateSequence: vi.fn(),
  addSequenceStep: vi.fn().mockResolvedValue({ id: "estep_new" }),
  updateSequenceStep: vi.fn().mockResolvedValue({ id: "estep_1" }),
  enrollContactsInFollowUp: vi.fn(),
  listActiveEnrollmentsForContact: vi.fn(),
  getSequenceReportingStats: vi.fn(),
  CreateEmailSequenceStepSchema: {
    parse: vi.fn((value) => value),
  },
}));

import {
  addSequenceStep,
  getSequence,
  getSequenceStep,
  updateSequenceStep,
} from "@workspace/campaigns";
import {
  createFollowUpStepAction,
  updateFollowUpStepAction,
} from "./follow-up-actions";

describe("createFollowUpStepAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("creates a default editor step and returns its id", async () => {
    vi.mocked(getSequence).mockResolvedValue({
      id: "eseq_1",
      kind: "follow_up",
      steps: [{ id: "estep_1" }, { id: "estep_2" }],
    } as unknown as NonNullable<Awaited<ReturnType<typeof getSequence>>>);

    const result = await createFollowUpStepAction("eseq_1");

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({ campaign: ["update"] });
    expect(addSequenceStep).toHaveBeenCalledWith(
      "eseq_1",
      "org_1",
      expect.objectContaining({
        sortOrder: 2,
        delayMinutes: 1440,
        contentSource: "editor",
        subjectTemplate: "Hello {{firstName}}",
        composedBodyHtml: expect.stringContaining("We wanted to reach out."),
      }),
    );
    expect(result).toEqual({ success: true, data: { id: "estep_new" } });
  });
});

describe("updateFollowUpStepAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("updates only a step that belongs to the follow-up", async () => {
    vi.mocked(getSequenceStep).mockResolvedValue({
      id: "estep_1",
      sequenceId: "eseq_1",
      sequence: { kind: "follow_up" },
    } as unknown as NonNullable<Awaited<ReturnType<typeof getSequenceStep>>>);

    const result = await updateFollowUpStepAction("eseq_1", "estep_1", {
      sortOrder: 0,
      delayMinutes: 0,
      contentSource: "editor",
      templateKey: "nurture-intro",
      subjectTemplate: "Updated subject",
      editorDocument: "<p>Hi</p>",
      composedBodyHtml: "<p>Hi</p>",
      composedBodyText: "Hi",
    });

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({ campaign: ["update"] });
    expect(updateSequenceStep).toHaveBeenCalledWith(
      "estep_1",
      "eseq_1",
      "org_1",
      expect.objectContaining({ subjectTemplate: "Updated subject" }),
    );
    expect(result).toEqual({ success: true, data: { id: "estep_1" } });
  });
});
