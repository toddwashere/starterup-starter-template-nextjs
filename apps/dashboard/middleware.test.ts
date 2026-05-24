import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "./middleware";

function buildRequest(path: string, hasCookie = false): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  const req = new NextRequest(url);
  if (hasCookie) {
    req.cookies.set("better-auth.session_token", "valid-token");
  }
  return req;
}

describe("middleware", () => {
  it("passes through /api/auth requests regardless of auth state", () => {
    const res = middleware(buildRequest("/api/auth/session"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.status).not.toBe(307);
  });

  it("passes through /api/clear-session so stale cookies can be cleared", () => {
    const res = middleware(buildRequest("/api/clear-session"));
    expect(res.status).not.toBe(307);
  });

  it("passes through OAuth authorization server metadata without auth", () => {
    const res = middleware(
      buildRequest("/.well-known/oauth-authorization-server/api/auth"),
    );
    expect(res.status).not.toBe(307);
  });

  it("redirects unauthenticated user on protected path to /sign-in", () => {
    const res = middleware(buildRequest("/create-org"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("redirectTo")).toBe("/create-org");
  });

  it("allows unauthenticated user on /sign-in", () => {
    const res = middleware(buildRequest("/sign-in"));
    expect(res.status).not.toBe(307);
  });

  it("allows unauthenticated user on /sign-up", () => {
    const res = middleware(buildRequest("/sign-up"));
    expect(res.status).not.toBe(307);
  });

  it("allows unauthenticated user on /forgot-password", () => {
    const res = middleware(buildRequest("/forgot-password"));
    expect(res.status).not.toBe(307);
  });

  it("allows authenticated user on protected path", () => {
    const res = middleware(buildRequest("/create-org", true));
    expect(res.status).not.toBe(307);
  });

  it("redirects authenticated user away from /sign-in to /", () => {
    const res = middleware(buildRequest("/sign-in", true));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/");
  });

  it("redirects authenticated user away from /sign-up to /", () => {
    const res = middleware(buildRequest("/sign-up", true));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/");
  });
});
