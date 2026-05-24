import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDelete = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ delete: mockDelete }),
}));

import { GET } from "./route";

describe("GET /api/clear-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes both session cookie variants", async () => {
    await GET();

    expect(mockDelete).toHaveBeenCalledWith("better-auth.session_token");
    expect(mockDelete).toHaveBeenCalledWith(
      "__Secure-better-auth.session_token",
    );
  });

  it("redirects to /sign-in", async () => {
    const response = await GET();

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
  });

  it("deletes cookies before redirecting to prevent redirect loops", async () => {
    await GET();

    expect(mockDelete).toHaveBeenCalledTimes(2);
  });
});
