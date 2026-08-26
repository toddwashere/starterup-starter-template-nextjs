import { describe, it, expect, vi, beforeEach } from "vitest";

const mockDelete = vi.fn();
vi.mock("next/headers", () => ({
  cookies: () => Promise.resolve({ delete: mockDelete }),
}));

import { GET } from "./route";

const REQUEST = new Request("http://localhost:4000/api/clear-session");

describe("GET /api/clear-session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes both session cookie variants", async () => {
    await GET(REQUEST);

    expect(mockDelete).toHaveBeenCalledWith("better-auth.session_token");
    expect(mockDelete).toHaveBeenCalledWith("__Secure-better-auth.session_token");
  });

  it("redirects to /sign-in", async () => {
    const response = await GET(REQUEST);

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
  });

  it("deletes cookies before redirecting to prevent redirect loops", async () => {
    await GET(REQUEST);

    expect(mockDelete).toHaveBeenCalledTimes(2);
  });
});
