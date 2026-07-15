import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  BulkEditMemberRolesButtonModal,
  type BulkEditMemberRolesButtonModalProps,
  type BulkEditMemberRolesResult,
} from "./bulk-edit-member-roles-button-modal";
import { showNiceModal, createTestQueryClient } from "./__nice-modal-test-utils";

const { bulkMemberRolesAction } = vi.hoisted(() => ({
  bulkMemberRolesAction: vi.fn(),
}));

vi.mock("../data/org-actions", () => ({
  bulkMemberRolesAction,
}));

const baseProps: BulkEditMemberRolesButtonModalProps = {
  organizationId: "org_1",
  orgSlug: "acme",
  operation: "add",
  selectedMembers: [
    { id: "member_a", name: "Ada Lovelace" },
    { id: "member_b", name: "Bob Bee" },
  ],
};

async function openModal(
  overrides: Partial<BulkEditMemberRolesButtonModalProps> = {},
) {
  const queryClient = createTestQueryClient();
  const { result } = await showNiceModal<
    BulkEditMemberRolesButtonModalProps,
    BulkEditMemberRolesResult
  >(BulkEditMemberRolesButtonModal, { ...baseProps, ...overrides }, queryClient);
  await screen.findByRole("heading");
  return { queryClient, result };
}

describe("BulkEditMemberRolesButtonModal", () => {
  beforeEach(() => {
    bulkMemberRolesAction.mockReset();
  });

  it("identifies the add operation in title and copy", async () => {
    await openModal({ operation: "add" });

    expect(
      screen.getByRole("heading", { name: "Add roles" }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Add the selected roles to 2 selected members/i)).toBeInTheDocument();
  });

  it("identifies the remove operation in title and copy", async () => {
    await openModal({ operation: "remove" });

    expect(
      screen.getByRole("heading", { name: "Remove roles" }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Remove the selected roles from 2 selected members/i),
    ).toBeInTheDocument();
  });

  it("shows admin/member role checkboxes but not owner", async () => {
    await openModal();

    expect(screen.getByRole("checkbox", { name: "Admin" })).toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Member" })).toBeInTheDocument();
    expect(screen.queryByText("Owner")).not.toBeInTheDocument();
  });

  it("shows the selected member count before submit", async () => {
    await openModal();

    expect(screen.getByText("2 selected members")).toBeInTheDocument();
  });

  it("submits exact member IDs, operation, and roles", async () => {
    const user = userEvent.setup();
    bulkMemberRolesAction.mockResolvedValue({
      success: true,
      data: {
        outcomes: [
          { memberId: "member_a", status: "updated", roles: ["admin"] },
          { memberId: "member_b", status: "updated", roles: ["admin"] },
        ],
      },
    });
    await openModal({ operation: "remove" });

    await user.click(screen.getByRole("checkbox", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Remove roles" }));

    await waitFor(() => {
      expect(bulkMemberRolesAction).toHaveBeenCalledWith({
        organizationId: "org_1",
        memberIds: ["member_a", "member_b"],
        operation: "remove",
        roles: ["admin"],
      });
    });
  });

  it("renders updated/unchanged/failed counts after submit", async () => {
    const user = userEvent.setup();
    bulkMemberRolesAction.mockResolvedValue({
      success: true,
      data: {
        outcomes: [
          { memberId: "member_a", status: "updated", roles: ["admin"] },
          { memberId: "member_b", status: "unchanged", roles: ["admin"] },
        ],
      },
    });
    await openModal();

    await user.click(screen.getByRole("checkbox", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Add roles" }));

    expect(
      await screen.findByText("1 updated, 1 unchanged, 0 failed"),
    ).toBeInTheDocument();
  });

  it("keeps the dialog open and shows failed member names when failures exist", async () => {
    const user = userEvent.setup();
    bulkMemberRolesAction.mockResolvedValue({
      success: true,
      data: {
        outcomes: [
          { memberId: "member_a", status: "updated", roles: ["admin"] },
          {
            memberId: "member_b",
            status: "failed",
            code: "SAME_OR_HIGHER_RANK",
            message: "Only owners can manage admins.",
          },
        ],
      },
    });
    await openModal();

    await user.click(screen.getByRole("checkbox", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Add roles" }));

    expect(
      await screen.findByText("1 updated, 0 unchanged, 1 failed"),
    ).toBeInTheDocument();
    expect(screen.getByText(/Bob Bee/)).toBeInTheDocument();
    expect(screen.getByText(/Only owners can manage admins\./)).toBeInTheDocument();
    // Dialog stays open for review.
    expect(
      screen.getByRole("heading", { name: "Add roles" }),
    ).toBeInTheDocument();
  });

  it("resolves with failedMemberIds so the caller can retain them in selection", async () => {
    const user = userEvent.setup();
    bulkMemberRolesAction.mockResolvedValue({
      success: true,
      data: {
        outcomes: [
          { memberId: "member_a", status: "updated", roles: ["admin"] },
          {
            memberId: "member_b",
            status: "failed",
            code: "SAME_OR_HIGHER_RANK",
            message: "Only owners can manage admins.",
          },
        ],
      },
    });
    const { result } = await openModal();

    await user.click(screen.getByRole("checkbox", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Add roles" }));

    await user.click(await screen.findByRole("button", { name: "Done" }));

    await expect(result).resolves.toEqual({ failedMemberIds: ["member_b"] });
  });

  it("invalidates members + member-management-context query keys on success", async () => {
    const user = userEvent.setup();
    bulkMemberRolesAction.mockResolvedValue({
      success: true,
      data: {
        outcomes: [{ memberId: "member_a", status: "updated", roles: ["admin"] }],
      },
    });
    const { queryClient } = await openModal({
      selectedMembers: [{ id: "member_a", name: "Ada Lovelace" }],
    });
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(screen.getByRole("checkbox", { name: "Admin" }));
    await user.click(screen.getByRole("button", { name: "Add roles" }));

    await waitFor(() => {
      expect(invalidateSpy).toHaveBeenCalledWith({
        queryKey: ["members", "acme"],
      });
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["member-management-context", "org_1"],
    });
  });
});
