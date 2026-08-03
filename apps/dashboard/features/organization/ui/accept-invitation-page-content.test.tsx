import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "./__nice-modal-test-utils";
import { AcceptInvitationPageContent } from "./accept-invitation-page-content";

const mockGetInvitation = vi.fn();
const mockUseSession = vi.fn();
const mockPush = vi.fn();
const mockSignOut = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@workspace/auth/client", () => ({
  authClient: {
    useSession: () => mockUseSession(),
    signOut: (...args: unknown[]) => mockSignOut(...args),
    organization: {
      getInvitation: (...args: unknown[]) => mockGetInvitation(...args),
      acceptInvitation: vi.fn(),
      rejectInvitation: vi.fn(),
    },
  },
}));


function renderPage(invitationId = "authinv_test") {
  const client = createTestQueryClient();
  return render(
    <QueryClientProvider client={client}>
      <AcceptInvitationPageContent invitationId={invitationId} />
    </QueryClientProvider>,
  );
}

function expectRedirectToAcceptInvitation(
  link: HTMLElement,
  invitationId: string,
) {
  expect(link.getAttribute("href") ?? "").toMatch(
    new RegExp(`redirectTo=.*accept-invitation%2F${invitationId}`),
  );
}

describe("AcceptInvitationPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("prompts sign-in without calling getInvitation when unauthenticated", async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    renderPage("authinv_abc");

    expect(await screen.findByText(/sign in required/i)).toBeInTheDocument();
    expect(mockGetInvitation).not.toHaveBeenCalled();

    const signIn = screen.getByRole("link", { name: /sign in/i });
    expectRedirectToAcceptInvitation(signIn, "authinv_abc");
  });

  it("offers create-account with the same redirectTo when unauthenticated", async () => {
    mockUseSession.mockReturnValue({ data: null, isPending: false });
    renderPage("authinv_abc");

    expect(await screen.findByText(/sign in required/i)).toBeInTheDocument();

    const createAccount = screen.getByRole("link", { name: /create account/i });
    expect(createAccount.getAttribute("href") ?? "").toMatch(/^\/sign-up/);
    expectRedirectToAcceptInvitation(createAccount, "authinv_abc");
  });

  it("fetches invitation only after session is present", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "user_1", email: "invitee@example.com" } },
      isPending: false,
    });
    mockGetInvitation.mockResolvedValue({
      id: "authinv_abc",
      organizationName: "Acme",
      organizationSlug: "acme",
      role: "member",
      inviterEmail: "owner@example.com",
    });

    renderPage("authinv_abc");

    await waitFor(() =>
      expect(mockGetInvitation).toHaveBeenCalledWith({
        query: { id: "authinv_abc" },
      }),
    );
    expect(mockGetInvitation).toHaveBeenCalledTimes(1);
    expect(
      await screen.findByText(/organization invitation/i),
    ).toBeInTheDocument();
    expect(screen.getByText("Acme")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /accept invitation/i }),
    ).toBeInTheDocument();
  });

  it("shows invalid invitation when authenticated fetch fails", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "user_1", email: "invitee@example.com" } },
      isPending: false,
    });
    mockGetInvitation.mockRejectedValue(new Error("Invitation not found!"));

    renderPage("authinv_abc");

    expect(await screen.findByText(/invalid invitation/i)).toBeInTheDocument();
    expect(screen.queryByText(/sign in required/i)).not.toBeInTheDocument();
    expect(
      screen.getByText(/ask an admin to send a new invitation/i),
    ).toBeInTheDocument();
  });

  it("shows wrong-account messaging when signed-in email is not the recipient", async () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "user_1", email: "other@example.com" } },
      isPending: false,
    });
    mockGetInvitation.mockRejectedValue(
      new Error("You are not the recipient of the invitation"),
    );

    renderPage("authinv_abc");

    expect(await screen.findByText(/wrong account/i)).toBeInTheDocument();
    expect(screen.getByText("other@example.com")).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /switch account/i }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/invalid invitation/i)).not.toBeInTheDocument();
  });

  it("shows verify-email messaging when invitation requires verification", async () => {
    mockUseSession.mockReturnValue({
      data: {
        user: { id: "user_1", email: "invitee@example.com", emailVerified: false },
      },
      isPending: false,
    });
    mockGetInvitation.mockRejectedValue(
      new Error(
        "Email verification required to view or list invitations for the session email",
      ),
    );

    renderPage("authinv_abc");

    expect(
      await screen.findByText("Verify your email", { selector: "[data-slot=card-title]" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: /check verification instructions/i }),
    ).toHaveAttribute(
      "href",
      "/verify-email?redirectTo=%2Faccept-invitation%2Fauthinv_abc",
    );
  });


  it("shows loading skeleton without calling getInvitation while session is pending", () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true });
    renderPage("authinv_abc");

    expect(screen.queryByText(/sign in required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/invalid invitation/i)).not.toBeInTheDocument();
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(mockGetInvitation).not.toHaveBeenCalled();
  });

  it("shows loading skeleton without calling getInvitation when cached user exists but session is still pending", () => {
    mockUseSession.mockReturnValue({
      data: { user: { id: "user_1", email: "invitee@example.com" } },
      isPending: true,
    });
    renderPage("authinv_abc");

    expect(screen.queryByText(/sign in required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/organization invitation/i)).not.toBeInTheDocument();
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(mockGetInvitation).not.toHaveBeenCalled();
  });
});
