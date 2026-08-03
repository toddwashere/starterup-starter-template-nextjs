import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignInPageContent } from "./sign-in-page-content";

const mockPush = vi.fn();
const mockSignInEmail = vi.fn();
const mockInvalidateOrganizationList = vi.fn();
const mockSearchParamsGet = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: mockSearchParamsGet }),
}));

vi.mock("../data/auth-client", () => ({
  authClient: {
    signIn: {
      email: (...args: unknown[]) => mockSignInEmail(...args),
    },
  },
  invalidateOrganizationList: () => mockInvalidateOrganizationList(),
}));

describe("SignInPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
    mockSignInEmail.mockResolvedValue({});
  });

  it("redirects to / after sign-in when redirectTo is absent", async () => {
    const user = userEvent.setup();
    render(<SignInPageContent />);

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });

  it("honors safe redirectTo after sign-in", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "redirectTo" ? "/accept-invitation/authinv_abc" : null,
    );
    const user = userEvent.setup();
    render(<SignInPageContent />);

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        "/accept-invitation/authinv_abc",
      ),
    );
  });

  it("preserves redirectTo on the sign-up cross-link", () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "redirectTo" ? "/accept-invitation/authinv_abc" : null,
    );
    render(<SignInPageContent />);

    const signUp = screen.getByRole("link", { name: /sign up/i });
    expect(signUp.getAttribute("href")).toMatch(
      /\/sign-up\?redirectTo=%2Faccept-invitation%2Fauthinv_abc/,
    );
  });

  it("ignores unsafe redirectTo values", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "redirectTo" ? "https://evil.example/phish" : null,
    );
    const user = userEvent.setup();
    render(<SignInPageContent />);

    await user.type(screen.getByLabelText("Email"), "user@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.click(screen.getByRole("button", { name: /sign in/i }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/"));
  });
});
