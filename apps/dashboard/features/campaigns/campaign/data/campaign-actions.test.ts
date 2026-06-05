import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";

vi.mock("@workspace/auth/guards", () => ({
  requireOrgPermissionWithActiveOrg: vi.fn().mockResolvedValue({
    session: { user: { id: "user_1", email: "user@example.com", name: "Test User" } },
    activeOrganizationId: "org_1",
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn().mockResolvedValue(new Headers()),
}));

vi.mock("@workspace/auth", () => ({
  auth: {
    api: {
      getFullOrganization: vi.fn().mockResolvedValue({ name: "Acme Inc" }),
    },
  },
}));

vi.mock("@workspace/campaigns", () => ({
  listSequences: vi.fn().mockResolvedValue([
    { id: "eseq_1", name: "Welcome", kind: "campaign", status: "draft", steps: [] },
  ]),
  getSequence: vi.fn(),
  createSequence: vi.fn().mockResolvedValue({ id: "eseq_new" }),
  updateSequence: vi.fn().mockResolvedValue({ id: "eseq_1" }),
  addSequenceStep: vi.fn(),
  updateSequenceStep: vi.fn(),
  startCampaignRun: vi.fn().mockResolvedValue({ id: "ecrun_1" }),
  pauseCampaignSequence: vi.fn(),
  getLatestCampaignRunForSequence: vi.fn().mockResolvedValue(null),
  getSequenceReportingStats: vi.fn(),
  marketingTemplateRegistry: {
    "nurture-intro": {
      label: "Nurture intro",
      description: "Short intro",
      propsSchema: { parse: vi.fn().mockReturnValue({}) },
    },
  },
  signMarketingToken: vi.fn().mockReturnValue("signed-token"),
  keys: vi.fn().mockReturnValue({ NEXT_PUBLIC_WWW_URL: "http://localhost:4001" }),
}));

vi.mock("@workspace/email/marketing/send-marketing-email", () => ({
  sendMarketingEmail: vi.fn().mockResolvedValue({ providerMessageId: "msg_1" }),
}));

import {
  listSequences,
  startCampaignRun,
  createSequence,
  getSequence,
} from "@workspace/campaigns";
import { sendMarketingEmail } from "@workspace/email/marketing/send-marketing-email";
import {
  createCampaignSequenceAction,
  listCampaignSequencesAction,
  pauseCampaignSequenceAction,
  sendCampaignTestEmailAction,
  startCampaignRunAction,
} from "./campaign-actions";

describe("listCampaignSequencesAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires campaign read permission", async () => {
    await listCampaignSequencesAction();
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({ campaign: ["read"] });
    expect(listSequences).toHaveBeenCalledWith("org_1", "campaign");
  });
});

describe("createCampaignSequenceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires campaign create permission and forces campaign kind", async () => {
    const result = await createCampaignSequenceAction({
      kind: "campaign",
      name: "Launch",
      slug: "launch",
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({ campaign: ["create"] });
    expect(createSequence).toHaveBeenCalledWith(
      "org_1",
      "user_1",
      expect.objectContaining({ kind: "campaign", name: "Launch", slug: "launch" }),
    );
    expect(result).toEqual({ success: true, data: { id: "eseq_new" } });
  });
});

describe("startCampaignRunAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires campaign send permission", async () => {
    const result = await startCampaignRunAction("eseq_1", "seg_1");
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({ campaign: ["send"] });
    expect(startCampaignRun).toHaveBeenCalledWith("org_1", "eseq_1", "seg_1", "user_1");
    expect(result).toEqual({ success: true, data: { id: "ecrun_1" } });
  });
});

describe("pauseCampaignSequenceAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires campaign update permission", async () => {
    const result = await pauseCampaignSequenceAction("eseq_1");
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({ campaign: ["update"] });
    expect(result).toEqual({ success: true, data: undefined });
  });
});

describe("sendCampaignTestEmailAction", () => {
  beforeEach(() => vi.clearAllMocks());

  it("requires campaign send permission and sends step 1 to the current user", async () => {
    vi.mocked(getSequence).mockResolvedValue({
      id: "eseq_1",
      kind: "campaign",
      name: "Welcome",
      slug: "welcome",
      steps: [
        {
          id: "estep_1",
          sortOrder: 0,
          delayMinutes: 0,
          templateKey: "nurture-intro",
          subjectTemplate: "Hello {{firstName}}",
          templateProps: { bodyIntro: "Hi", ctaUrl: "https://example.com", ctaLabel: "Go" },
        },
      ],
    } as unknown as NonNullable<Awaited<ReturnType<typeof getSequence>>>);

    const result = await sendCampaignTestEmailAction("eseq_1");
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenCalledWith({ campaign: ["send"] });
    expect(sendMarketingEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: "user@example.com",
        subjectTemplate: "Hello {{firstName}}",
      }),
    );
    expect(result).toEqual({ success: true, data: undefined });
  });

  it("rejects when the campaign has no steps", async () => {
    vi.mocked(getSequence).mockResolvedValue({
      id: "eseq_1",
      kind: "campaign",
      name: "Welcome",
      slug: "welcome",
      steps: [],
    } as unknown as NonNullable<Awaited<ReturnType<typeof getSequence>>>);

    const result = await sendCampaignTestEmailAction("eseq_1");
    expect(result.success).toBe(false);
    expect(sendMarketingEmail).not.toHaveBeenCalled();
  });
});
