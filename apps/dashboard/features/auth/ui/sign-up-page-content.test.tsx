import "@testing-library/jest-dom/vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { SignUpPageContent } from "./sign-up-page-content";

const mockPush = vi.fn();
const mockSignUpEmail = vi.fn();
const mockInvalidateOrganizationList = vi.fn();
const mockSearchParamsGet = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
  useSearchParams: () => ({ get: mockSearchParamsGet }),
}));

vi.mock("../data/auth-client", () => ({
  authClient: {
    signUp: {
      email: (...args: unknown[]) => mockSignUpEmail(...args),
    },
  },
  invalidateOrganizationList: () => mockInvalidateOrganizationList(),
}));

describe("SignUpPageContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSearchParamsGet.mockReturnValue(null);
    mockSignUpEmail.mockResolvedValue({});
  });

  it("honors safe redirectTo after sign-up", async () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "redirectTo" ? "/accept-invitation/authinv_abc" : null,
    );
    const user = userEvent.setup();
    render(<SignUpPageContent />);

    await user.type(screen.getByLabelText("Name"), "Ada");
    await user.type(screen.getByLabelText("Email"), "ada@example.com");
    await user.type(screen.getByLabelText("Password"), "password123");
    await user.type(screen.getByLabelText("Confirm Password"), "password123");
    await user.click(screen.getByRole("button", { name: /sign up/i }));

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith(
        "/accept-invitation/authinv_abc",
      ),
    );
  });

  it("preserves redirectTo on the sign-in cross-link", () => {
    mockSearchParamsGet.mockImplementation((key: string) =>
      key === "redirectTo" ? "/accept-invitation/authinv_abc" : null,
    );
    render(<SignUpPageContent />);

    const signIn = screen.getByRole("link", { name: /sign in/i });
    expect(signIn.getAttribute("href")).toMatch(
      /\/sign-in\?redirectTo=%2Faccept-invitation%2Fauthinv_abc/,
    );
  });
});
