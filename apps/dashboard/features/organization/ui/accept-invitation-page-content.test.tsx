import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTestQueryClient } from "./__nice-modal-test-utils";
import { AcceptInvitationPageContent } from "./accept-invitation-page-content";

const mockGetInvitation = vi.fn();
const mockUseSession = vi.fn();
const mockPush = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

vi.mock("@workspace/auth/client", () => ({
  authClient: {
    useSession: () => mockUseSession(),
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
  });

  it("shows loading skeleton without calling getInvitation while session is pending", () => {
    mockUseSession.mockReturnValue({ data: null, isPending: true });
    renderPage("authinv_abc");

    expect(screen.queryByText(/sign in required/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/invalid invitation/i)).not.toBeInTheDocument();
    expect(document.querySelector(".animate-pulse")).toBeInTheDocument();
    expect(mockGetInvitation).not.toHaveBeenCalled();
  });
});
