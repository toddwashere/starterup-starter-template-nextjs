import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  EditMemberRolesButtonModal,
  type EditMemberRolesButtonModalProps,
} from "./edit-member-roles-button-modal";
import { showNiceModal, createTestQueryClient } from "./__nice-modal-test-utils";

const { replaceMemberRolesAction } = vi.hoisted(() => ({
  replaceMemberRolesAction: vi.fn(),
}));

vi.mock("../data/org-actions", () => ({
  replaceMemberRolesAction,
}));

const baseProps: EditMemberRolesButtonModalProps = {
  organizationId: "org_1",
  orgSlug: "acme",
  memberId: "member_1",
  memberName: "Ada Lovelace",
  currentRoles: ["member"],
};

async function openModal(
  overrides: Partial<EditMemberRolesButtonModalProps> = {},
) {
  const queryClient = createTestQueryClient();
  const { result } = await showNiceModal(
    EditMemberRolesButtonModal,
    { ...baseProps, ...overrides },
    queryClient,
  );
  await screen.findByText("Edit roles");
  return { queryClient, result };
}

describe("EditMemberRolesButtonModal", () => {
  beforeEach(() => {
    replaceMemberRolesAction.mockReset();
  });

  it("shows catalog-derived checkboxes for admin/member but not owner", async () => {
    await openModal();

    expect(screen.getByRole("checkbox", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Member" })).toBeInTheDocument();
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
  });

  it("initializes checked state from currentRoles", async () => {
    await openModal({ currentRoles: ["admin"] });

    expect(screen.getByRole("checkbox", { name: "Admin" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Member" })).not.toBeChecked();
  });

  it("disables submit when the selected role set becomes empty", async () => {
    const user = userEvent.setup();
    await openModal({ currentRoles: ["member"] });

    const submit = screen.getByRole("button", { name: "Save roles" });
    expect(submit).not.toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: "Member" }));

    expect(submit).toBeDisabled();
  });

  it("renders unknown current roles as read-only badges and disables submit with a repair message", async () => {
    await openModal({ currentRoles: ["admin", "legacy-super-admin"] });

    expect(screen.getByText("legacy-super-admin")).toBeInTheDocument();
    expect(
      screen.getByText(/no longer recognized/i),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Save roles" })).toBeDisabled();
    // Checkboxes are not rendered while roles need repair.
    expect(
      screen.queryByRole("checkbox", { name: "Admin" }),
    ).not.toBeInTheDocument();
  });

  it("shows the typed error and keeps the dialog open when the action fails", async () => {
    const user = userEvent.setup();
    replaceMemberRolesAction.mockResolvedValue({
      success: false,
      error: { code: "MISSING_PERMISSION", message: "You cannot do that." },
    });
    const { queryClient } = await openModal({ currentRoles: ["member"] });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(screen.getByRole("button", { name: "Save roles" }));

    expect(await screen.findByText("You cannot do that.")).toBeInTheDocument();
    expect(screen.getByText("Edit roles")).toBeInTheDocument();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("shows the outcome message and keeps the dialog open when status is failed", async () => {
    const user = userEvent.setup();
    replaceMemberRolesAction.mockResolvedValue({
      success: true,
      data: {
        memberId: "member_1",
        status: "failed",
        code: "SAME_OR_HIGHER_RANK",
        message: "Only owners can manage admins.",
      },
    });
    await openModal({ currentRoles: ["member"] });

    await user.click(screen.getByRole("button", { name: "Save roles" }));

    expect(
      await screen.findByText("Only owners can manage admins."),
    ).toBeInTheDocument();
    expect(screen.getByText("Edit roles")).toBeInTheDocument();
  });

  it("invalidates members + member-management-context and resolves on success", async () => {
    const user = userEvent.setup();
    replaceMemberRolesAction.mockResolvedValue({
      success: true,
      data: { memberId: "member_1", status: "updated", roles: ["admin"] },
    });
    const { queryClient, result } = await openModal({ currentRoles: ["member"] });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(screen.getByRole("checkbox", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Save roles" }));

    await waitFor(() => {
      expect(screen.queryByText("Edit roles")).not.toBeInTheDocument();
    });

    expect(replaceMemberRolesAction).toHaveBeenCalledWith({
      organizationId: "org_1",
      memberId: "member_1",
      roles: ["member", "admin"],
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["members", "acme"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["member-management-context", "org_1"],
    });

    await expect(result).resolves.toEqual({
      memberId: "member_1",
      status: "updated",
      roles: ["admin"],
    });
  });

  it("resolves for an unchanged outcome too", async () => {
    const user = userEvent.setup();
    replaceMemberRolesAction.mockResolvedValue({
      success: true,
      data: { memberId: "member_1", status: "unchanged", roles: ["member"] },
    });
    const { result } = await openModal({ currentRoles: ["member"] });

    await user.click(screen.getByRole("button", { name: "Save roles" }));

    await waitFor(() => {
      expect(screen.queryByText("Edit roles")).not.toBeInTheDocument();
    });
    await expect(result).resolves.toEqual({
      memberId: "member_1",
      status: "unchanged",
      roles: ["member"],
    });
  });
});
