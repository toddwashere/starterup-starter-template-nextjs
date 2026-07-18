import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { proxy } from "./proxy";

function buildRequest(path: string, hasCookie = false): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  const req = new NextRequest(url);
  if (hasCookie) {
    req.cookies.set("better-auth.session_token", "valid-token");
  }
  return req;
}

describe("proxy", () => {
  it("passes through /api/auth requests regardless of auth state", () => {
    const res = proxy(buildRequest("/api/auth/session"));
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(res.status).not.toBe(307);
  });

  it("passes through /api/clear-session so stale cookies can be cleared", () => {
    const res = proxy(buildRequest("/api/clear-session"));
    expect(res.status).not.toBe(307);
  });

  it("passes through OAuth authorization server metadata without auth", () => {
    const res = proxy(
      buildRequest("/.well-known/oauth-authorization-server/api/auth"),
    );
    expect(res.status).not.toBe(307);
  });

  it("redirects unauthenticated user on protected path to /sign-in", () => {
    const res = proxy(buildRequest("/create-org"));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("redirectTo")).toBe("/create-org");
  });

  it("allows unauthenticated user on /sign-in", () => {
    const res = proxy(buildRequest("/sign-in"));
    expect(res.status).not.toBe(307);
  });

  it("allows unauthenticated user on /sign-up", () => {
    const res = proxy(buildRequest("/sign-up"));
    expect(res.status).not.toBe(307);
  });

  it("allows unauthenticated user on /forgot-password", () => {
    const res = proxy(buildRequest("/forgot-password"));
    expect(res.status).not.toBe(307);
  });

  it("allows unauthenticated user on /status", () => {
    const res = proxy(buildRequest("/status"));
    expect(res.status).not.toBe(307);
  });

  it("allows unauthenticated user to call /api/ready", () => {
    const res = proxy(buildRequest("/api/ready"));
    expect(res.status).not.toBe(307);
  });

  it("allows unauthenticated user to call /api/status", () => {
    const res = proxy(buildRequest("/api/status"));
    expect(res.status).not.toBe(307);
  });

  it("allows authenticated user on protected path", () => {
    const res = proxy(buildRequest("/create-org", true));
    expect(res.status).not.toBe(307);
  });

  it("redirects authenticated user away from /sign-in to /", () => {
    const res = proxy(buildRequest("/sign-in", true));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/");
  });

  it("redirects authenticated user away from /sign-up to /", () => {
    const res = proxy(buildRequest("/sign-up", true));
    expect(res.status).toBe(307);
    const location = new URL(res.headers.get("location")!);
    expect(location.pathname).toBe("/");
  });
});
