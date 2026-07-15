import "@testing-library/jest-dom/vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  TransferOwnershipConfirmDialog,
  type TransferOwnershipConfirmDialogProps,
} from "./transfer-ownership-confirm-dialog";
import { showNiceModal, createTestQueryClient } from "./__nice-modal-test-utils";

const { transferOwnershipAction } = vi.hoisted(() => ({
  transferOwnershipAction: vi.fn(),
}));

vi.mock("../data/org-actions", () => ({
  transferOwnershipAction,
}));

const baseProps: TransferOwnershipConfirmDialogProps = {
  organizationId: "org_1",
  orgSlug: "acme",
  targetMemberId: "member_2",
  targetName: "Grace Hopper",
  actorRoles: ["owner"],
};

async function openModal(
  overrides: Partial<TransferOwnershipConfirmDialogProps> = {},
) {
  const queryClient = createTestQueryClient();
  const { result } = await showNiceModal(
    TransferOwnershipConfirmDialog,
    { ...baseProps, ...overrides },
    queryClient,
  );
  await screen.findByRole("heading", { name: "Transfer ownership" });
  return { queryClient, result };
}

describe("TransferOwnershipConfirmDialog", () => {
  beforeEach(() => {
    transferOwnershipAction.mockReset();
  });

  it("names the target member in the consequence copy", async () => {
    await openModal();

    expect(screen.getAllByText("Grace Hopper").length).toBeGreaterThan(0);
    expect(
      screen.getByText(/will become the owner, keeping their existing roles/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/you will lose the owner role/i)).toBeInTheDocument();
  });

  it("says the former owner becomes admin when owner was their sole role", async () => {
    await openModal({ actorRoles: ["owner"] });

    expect(
      screen.getByText(/since owner is currently your only role, you will become an admin/i),
    ).toBeInTheDocument();
  });

  it("says the former owner keeps their other roles when they held more than owner", async () => {
    await openModal({ actorRoles: ["owner", "admin"] });

    expect(
      screen.getByText(/you will keep your other role: admin/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/become an admin/i)).not.toBeInTheDocument();
  });

  it("shows the target's name regardless of which member is being promoted", async () => {
    await openModal({ targetMemberId: "member_9", targetName: "Ada Lovelace" });

    expect(screen.getAllByText("Ada Lovelace").length).toBeGreaterThan(0);
  });

  it("does not call transferOwnershipAction when cancelled", async () => {
    const user = userEvent.setup();
    await openModal();

    await user.click(screen.getByRole("button", { name: "Cancel" }));

    expect(transferOwnershipAction).not.toHaveBeenCalled();
  });

  it("submits organizationId and targetMemberId when confirmed", async () => {
    const user = userEvent.setup();
    transferOwnershipAction.mockResolvedValue({
      success: true,
      data: {
        previousOwnerRoles: ["admin"],
        newOwnerRoles: ["owner", "member"],
      },
    });
    await openModal();

    await user.click(
      screen.getByRole("button", { name: "Transfer ownership" }),
    );

    await waitFor(() => {
      expect(transferOwnershipAction).toHaveBeenCalledWith({
        organizationId: "org_1",
        targetMemberId: "member_2",
      });
    });
  });

  it("invalidates organization, members, and member-management-context and resolves true on success", async () => {
    const user = userEvent.setup();
    transferOwnershipAction.mockResolvedValue({
      success: true,
      data: {
        previousOwnerRoles: ["admin"],
        newOwnerRoles: ["owner", "member"],
      },
    });
    const { queryClient, result } = await openModal();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(
      screen.getByRole("button", { name: "Transfer ownership" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: "Transfer ownership" }),
      ).not.toBeInTheDocument();
    });

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["organization", "acme"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["members", "acme"],
    });
    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: ["member-management-context", "org_1"],
    });

    await expect(result).resolves.toBe(true);
  });

  it("shows the server error and keeps the dialog open on failure, without invalidating", async () => {
    const user = userEvent.setup();
    transferOwnershipAction.mockResolvedValue({
      success: false,
      error: {
        code: "OWNER_PROTECTED",
        message: "You cannot transfer ownership to this member.",
      },
    });
    const { queryClient } = await openModal();
    const invalidateSpy = vi.spyOn(queryClient, "invalidateQueries");

    await user.click(
      screen.getByRole("button", { name: "Transfer ownership" }),
    );

    expect(
      await screen.findByText("You cannot transfer ownership to this member."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "Transfer ownership" }),
    ).toBeInTheDocument();
    expect(invalidateSpy).not.toHaveBeenCalled();
  });
});
