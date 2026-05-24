import { beforeEach, describe, expect, it, vi } from "vitest";
import { requireOrgPermissionWithActiveOrg } from "@workspace/auth/guards";
import {
  archiveContactInteractionAction,
  createContactNoteAction,
  listContactInteractionsAction,
  updateContactInteractionAction,
} from "../../contact-interaction/data/contact-interaction-actions";
import {
  archiveContactTaskAction,
  createContactTaskAction,
  createContactTaskStatusAction,
  deleteContactTaskStatusAction,
  listContactTasksAction,
  listContactTasksForOrgAction,
  listContactTaskStatusesAction,
  updateContactTaskAction,
  updateContactTaskStatusAction,
} from "../../contact-task/data/contact-task-actions";
import {
  commitContactCsvImportAction,
  exportContactsCsvAction,
  previewContactCsvImportAction,
} from "./contact-csv-actions";
import {
  addTagToContactAction,
  createContactTagAction,
  deleteContactTagAction,
  listContactTagsAction,
  removeTagFromContactAction,
  setContactTagsAction,
  updateContactTagAction,
} from "../../contact-tag/data/contact-tag-actions";
import {
  createContactSegmentAction,
  deleteContactSegmentAction,
  listContactSegmentsAction,
  listContactsForSegmentAction,
} from "../../contact-segment/data/contact-segment-actions";
import { CURRENT_FILTER_VERSION } from "@workspace/contacts/schemas/segment-schemas";
import {
  createContactStageAction,
  deleteContactStageAction,
  listContactStagesAction,
  updateContactStageAction,
} from "../../contact-stage/data/contact-stage-actions";

vi.mock("@workspace/auth/guards", () => ({
  requireOrgPermissionWithActiveOrg: vi.fn().mockResolvedValue({
    session: { user: { id: "user_1" } },
    activeOrganizationId: "org_1",
  }),
}));

vi.mock("@workspace/contacts", () => ({
  createContactInteraction: vi.fn().mockResolvedValue({ id: "interaction_1" }),
  updateContactInteraction: vi.fn().mockResolvedValue({ id: "interaction_1" }),
  archiveContactInteraction: vi.fn().mockResolvedValue({ id: "interaction_1" }),
  listContactInteractions: vi.fn().mockResolvedValue([]),
  listContactTasksForOrg: vi.fn().mockResolvedValue([]),
  listContactTasksForContact: vi.fn().mockResolvedValue([]),
  createContactTask: vi.fn().mockResolvedValue({ id: "task_1" }),
  updateContactTask: vi.fn().mockResolvedValue({ id: "task_1" }),
  archiveContactTask: vi.fn().mockResolvedValue({ id: "task_1" }),
  listContactTaskStatusesForOrg: vi.fn().mockResolvedValue([]),
  createContactTaskStatus: vi.fn().mockResolvedValue({ id: "status_1" }),
  updateContactTaskStatus: vi.fn().mockResolvedValue({ id: "status_1" }),
  deleteContactTaskStatus: vi.fn().mockResolvedValue({ id: "status_1" }),
  parseContactsCsv: vi.fn().mockReturnValue({ valid: [] }),
  exportContactsToCsv: vi.fn().mockReturnValue("displayName,kind\n"),
  createContactWithValidation: vi.fn().mockResolvedValue({ id: "contact_1" }),
  listContactsForOrg: vi.fn().mockResolvedValue([]),
  listContactTagsForOrg: vi.fn().mockResolvedValue([]),
  createContactTag: vi.fn().mockResolvedValue({ id: "tag_1" }),
  updateContactTag: vi.fn().mockResolvedValue({ id: "tag_1" }),
  deleteContactTag: vi.fn().mockResolvedValue({ id: "tag_1" }),
  addTagToContact: vi.fn().mockResolvedValue(undefined),
  removeTagFromContact: vi.fn().mockResolvedValue(undefined),
  setContactTagsForContact: vi.fn().mockResolvedValue(undefined),
  listContactSegmentsForOrg: vi.fn().mockResolvedValue([]),
  createContactSegment: vi.fn().mockResolvedValue({ id: "cseg_1" }),
  deleteContactSegment: vi.fn().mockResolvedValue({ id: "cseg_1" }),
  listContactsForSegment: vi.fn().mockResolvedValue([]),
  listContactStagesForOrg: vi.fn().mockResolvedValue([]),
  createContactStage: vi.fn().mockResolvedValue({ id: "stage_1" }),
  updateContactStage: vi.fn().mockResolvedValue({ id: "stage_1" }),
  deleteContactStage: vi.fn().mockResolvedValue({ id: "stage_1" }),
}));

describe("contact domain action permissions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("requires interaction permissions for notes and interactions", async () => {
    await listContactInteractionsAction("contact_1");
    await createContactNoteAction("contact_1", "Followed up");
    await updateContactInteractionAction("interaction_1", { body: "Updated note" });
    await archiveContactInteractionAction("interaction_1");

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(1, {
      contactInteraction: ["read"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(2, {
      contactInteraction: ["create"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(3, {
      contactInteraction: ["update"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(4, {
      contactInteraction: ["delete"],
    });
  });

  it("requires contact task permissions for task records", async () => {
    await listContactTasksForOrgAction();
    await listContactTasksAction("contact_1");
    await createContactTaskAction({
      contactId: "contact_1",
      title: "Follow up",
      priority: "normal",
      sortOrder: 0,
    });
    await updateContactTaskAction("task_1", { title: "Follow up again" });
    await archiveContactTaskAction("task_1");

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(1, {
      contactTask: ["read"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(2, {
      contactTask: ["read"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(3, {
      contactTask: ["create"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(4, {
      contactTask: ["update"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(5, {
      contactTask: ["delete"],
    });
  });

  it("requires contact settings permissions for stages and task statuses", async () => {
    await listContactTaskStatusesAction();
    await createContactTaskStatusAction({
      name: "Todo",
      color: "#6366f1",
      sortOrder: 0,
      isDefault: false,
      isTerminal: false,
    });
    await updateContactTaskStatusAction("status_1", { name: "Doing" });
    await deleteContactTaskStatusAction("status_1");
    await listContactStagesAction();
    await createContactStageAction({
      name: "Lead",
      color: "#6366f1",
      sortOrder: 0,
      isDefault: false,
    });
    await updateContactStageAction("stage_1", { name: "Active" });
    await deleteContactStageAction("stage_1");

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(1, {
      contactSettings: ["read"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(2, {
      contactSettings: ["create"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(3, {
      contactSettings: ["update"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(4, {
      contactSettings: ["delete"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(5, {
      contactSettings: ["read"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(6, {
      contactSettings: ["create"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(7, {
      contactSettings: ["update"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(8, {
      contactSettings: ["delete"],
    });
  });

  it("requires contact read/update permissions for tags and tag assignment", async () => {
    await listContactTagsAction();
    await createContactTagAction({ name: "VIP", color: "#6366f1" });
    await updateContactTagAction("tag_1", { name: "Partner" });
    await deleteContactTagAction("tag_1");
    await addTagToContactAction("contact_1", "tag_1");
    await removeTagFromContactAction("contact_1", "tag_1");
    await setContactTagsAction("contact_1", ["VIP"]);

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(1, {
      contactSettings: ["read"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(2, {
      contactSettings: ["create"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(3, {
      contactSettings: ["update"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(4, {
      contactSettings: ["delete"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(5, {
      contact: ["update"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(6, {
      contact: ["update"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(7, {
      contact: ["update"],
    });
  });

  it("requires contact read and contactSettings for segments", async () => {
    await listContactSegmentsAction();
    await listContactsForSegmentAction("cseg_1");
    await createContactSegmentAction({
      name: "Active VIP",
      filters: { tagIds: ["tag_1"] },
      filterVersion: CURRENT_FILTER_VERSION,
      sortKey: "displayName",
      sortDirection: "asc",
    });
    await deleteContactSegmentAction("cseg_1");

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(1, {
      contact: ["read"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(2, {
      contact: ["read"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(3, {
      contactSettings: ["create"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(4, {
      contactSettings: ["delete"],
    });
  });

  it("requires import and export permissions for CSV flows", async () => {
    await previewContactCsvImportAction("displayName,kind\nJane Doe,person");
    await commitContactCsvImportAction("displayName,kind\nJane Doe,person");
    await exportContactsCsvAction();

    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(1, {
      contact: ["import"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(2, {
      contact: ["import"],
    });
    expect(requireOrgPermissionWithActiveOrg).toHaveBeenNthCalledWith(3, {
      contact: ["export"],
    });
  });
});
