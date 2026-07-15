import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  InviteMemberButtonModal,
  type InviteMemberButtonModalProps,
} from "./invite-member-button-modal";
import { showNiceModal, createTestQueryClient } from "./__nice-modal-test-utils";

const { inviteMemberAction } = vi.hoisted(() => ({
  inviteMemberAction: vi.fn(),
}));

vi.mock("../data/org-actions", () => ({
  inviteMemberAction,
}));

const baseProps: InviteMemberButtonModalProps = {
  organizationId: "org_1",
  orgSlug: "acme",
};

async function openModal(
  overrides: Partial<InviteMemberButtonModalProps> = {},
) {
  const queryClient = createTestQueryClient();
  const { result } = await showNiceModal(
    InviteMemberButtonModal,
    { ...baseProps, ...overrides },
    queryClient,
  );
  await screen.findByText("Invite member");
  return { queryClient, result };
}

describe("InviteMemberButtonModal", () => {
  beforeEach(() => {
    inviteMemberAction.mockReset();
  });

  it("shows catalog-derived checkboxes for admin/member but not owner", async () => {
    await openModal();

    expect(
      screen.getByRole("checkbox", { name: "Admin" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("checkbox", { name: "Member" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
  });

  it("allows selecting multiple roles at once", async () => {
    const user = userEvent.setup();
    await openModal();

    await user.click(screen.getByRole("checkbox", { name: "Admin" }));
    await user.click(screen.getByRole("checkbox", { name: "Member" }));

    expect(screen.getByRole("checkbox", { name: "Admin" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Member" })).toBeChecked();
  });

  it("blocks submission when no roles are selected", async () => {
    const user = userEvent.setup();
    await openModal();

    await user.type(
      screen.getByLabelText("Email address"),
      "new@example.com",
    );
    await user.click(
      screen.getByRole("button", { name: "Send invitation" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText("Select at least one role"),
      ).toBeInTheDocument();
    });
    expect(inviteMemberAction).not.toHaveBeenCalled();
  });

  it("shows the typed error and keeps the dialog open when the action fails", async () => {
    const user = userEvent.setup();
    inviteMemberAction.mockResolvedValue({
      success: false,
      error: {
        code: "MISSING_PERMISSION",
        message: "You cannot invite that role.",
      },
    });
    const { queryClient } = await openModal();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.type(
      screen.getByLabelText("Email address"),
      "new@example.com",
    );
    await user.click(screen.getByRole("checkbox", { name: "Member" }));
    await user.click(
      screen.getByRole("button", { name: "Send invitation" }),
    );

    expect(
      await screen.findByText("You cannot invite that role."),
    ).toBeInTheDocument();
    expect(screen.getByText("Invite member")).toBeInTheDocument();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });

  it("submits roles as an array, invalidates the organization query, and closes on success", async () => {
    const user = userEvent.setup();
    inviteMemberAction.mockResolvedValue({
      success: true,
      data: { id: "invitation_1" },
    });
    const { queryClient, result } = await openModal();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.type(
      screen.getByLabelText("Email address"),
      "new@example.com",
    );
    await user.click(screen.getByRole("checkbox", { name: "Admin" }));
    await user.click(screen.getByRole("checkbox", { name: "Member" }));
    await user.click(
      screen.getByRole("button", { name: "Send invitation" }),
    );

    await waitFor(() => {
      expect(screen.queryByText("Invite member")).not.toBeInTheDocument();
    });

    expect(inviteMemberAction).toHaveBeenCalledWith({
      organizationId: "org_1",
      email: "new@example.com",
      roles: ["admin", "member"],
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["organization", "acme"],
    });

    await expect(result).resolves.toEqual({ id: "invitation_1" });
  });
});
