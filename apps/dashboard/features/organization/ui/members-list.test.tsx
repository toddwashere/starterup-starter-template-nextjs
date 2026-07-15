import "@testing-library/jest-dom/vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { MembersList, type MemberRow } from "./members-list";

const allowedMemberA: MemberRow = {
  id: "member_a",
  name: "Ada Lovelace",
  email: "ada@example.com",
  image: null,
  roles: ["member"],
  createdAt: new Date("2024-01-01T00:00:00Z"),
  management: { allowed: true, reason: null, canTransferOwnership: false },
};

const allowedMemberB: MemberRow = {
  id: "member_b",
  name: "Bob Bee",
  email: "bob@example.com",
  image: null,
  roles: ["admin"],
  createdAt: new Date("2024-02-01T00:00:00Z"),
  management: { allowed: true, reason: null, canTransferOwnership: false },
};

const protectedOwner: MemberRow = {
  id: "member_owner",
  name: "Olivia Owner",
  email: "olivia@example.com",
  image: null,
  roles: ["owner"],
  createdAt: new Date("2024-03-01T00:00:00Z"),
  management: {
    allowed: false,
    reason: "OWNER_PROTECTED",
    canTransferOwnership: false,
  },
};

function renderMembersList(
  members: MemberRow[],
  overrides: Partial<React.ComponentProps<typeof MembersList>> = {},
) {
  const onEditRoles = vi.fn();
  const onTransferOwnership = vi.fn();
  const onRemove = vi.fn();
  const onBulkEditRoles = vi.fn();

  const props = {
    members,
    onEditRoles,
    onTransferOwnership,
    onRemove,
    onBulkEditRoles,
    ...overrides,
  };

  const utils = render(<MembersList {...props} />);
  return { ...utils, onEditRoles, onTransferOwnership, onRemove, onBulkEditRoles };
}

function desktopCheckboxFor(memberId: string): HTMLElement {
  const row = document.querySelector(`[data-row-id="${memberId}"]`);
  if (!row) throw new Error(`No desktop row for ${memberId}`);
  return within(row as HTMLElement).getByRole("checkbox");
}

function mobileCheckboxFor(memberId: string): HTMLElement {
  const card = screen.getByTestId(`member-row-mobile-${memberId}`);
  return within(card).getByRole("checkbox", { name: "Select member" });
}

describe("MembersList", () => {
  it("keeps desktop and mobile selection in sync and disables protected rows", async () => {
    const user = userEvent.setup();
    renderMembersList([allowedMemberA, protectedOwner]);

    expect(desktopCheckboxFor(allowedMemberA.id)).not.toBeChecked();
    expect(mobileCheckboxFor(allowedMemberA.id)).not.toBeChecked();

    // Protected member's checkbox is disabled in both views.
    expect(desktopCheckboxFor(protectedOwner.id)).toBeDisabled();
    expect(mobileCheckboxFor(protectedOwner.id)).toBeDisabled();

    await user.click(desktopCheckboxFor(allowedMemberA.id));

    // Selecting via the desktop checkbox is reflected on the mobile checkbox
    // for the same row — one shared TanStack RowSelectionState drives both.
    expect(desktopCheckboxFor(allowedMemberA.id)).toBeChecked();
    expect(mobileCheckboxFor(allowedMemberA.id)).toBeChecked();

    expect(screen.getByText("1 selected")).toBeInTheDocument();
  });

  it("cannot select a protected row by clicking its checkbox", async () => {
    const user = userEvent.setup();
    renderMembersList([allowedMemberA, protectedOwner]);

    await user.click(mobileCheckboxFor(protectedOwner.id));

    expect(desktopCheckboxFor(protectedOwner.id)).not.toBeChecked();
    expect(mobileCheckboxFor(protectedOwner.id)).not.toBeChecked();
  });

  it("after a bulk result, clears selection except failed member IDs", async () => {
    const user = userEvent.setup();
    const onBulkEditRoles = vi
      .fn()
      .mockResolvedValue({ failedMemberIds: [allowedMemberB.id] });

    renderMembersList([allowedMemberA, allowedMemberB, protectedOwner], {
      onBulkEditRoles,
    });

    await user.click(desktopCheckboxFor(allowedMemberA.id));
    await user.click(desktopCheckboxFor(allowedMemberB.id));
    expect(screen.getByText("2 selected")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Actions" }));
    await user.click(await screen.findByText("Add roles"));

    expect(onBulkEditRoles).toHaveBeenCalledWith("add", [
      allowedMemberA.id,
      allowedMemberB.id,
    ]);

    // Only the failed member stays selected; the successful one is cleared.
    expect(await screen.findByText("1 selected")).toBeInTheDocument();
    expect(desktopCheckboxFor(allowedMemberA.id)).not.toBeChecked();
    expect(desktopCheckboxFor(allowedMemberB.id)).toBeChecked();
  });
});
