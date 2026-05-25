import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@workspace/auth/api-keys", () => ({
  verifyApiKey: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {
    constructor(public code: string, message: string) {
      super(message);
    }
  },
}));

vi.mock("@workspace/auth/oauth/verify-access-token", () => ({
  verifyOAuthAccessToken: vi.fn(),
}));

vi.mock("@workspace/auth", () => ({
  auth: {
    api: {
      getSession: vi.fn(),
    },
  },
}));

import { verifyApiKey, ApiKeyError } from "@workspace/auth/api-keys";
import { verifyOAuthAccessToken } from "@workspace/auth/oauth/verify-access-token";
import { auth } from "@workspace/auth";
import { resolveMcpAuthContext, McpAuthError } from "./mcp-auth";
import type { IncomingMessage } from "node:http";

function makeReq(headers: Record<string, string>): IncomingMessage {
  return { headers } as unknown as IncomingMessage;
}

describe("resolveMcpAuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("authenticates via x-api-key header", async () => {
    vi.mocked(verifyApiKey).mockResolvedValue({
      keyId: "key_1",
      orgId: "org_1",
      userId: null,
      ownerType: "organization",
      permissions: { account: ["read"] },
    });

    const ctx = await resolveMcpAuthContext(
      makeReq({ "x-api-key": "sk_org_test" }),
    );
    expect(ctx.kind).toBe("api-key");
    expect(ctx.orgId).toBe("org_1");
  });

  it("authenticates via Bearer OAuth JWT", async () => {
    vi.mocked(verifyOAuthAccessToken).mockResolvedValue({
      userId: "user_oauth",
      orgId: "org_oauth",
      scopes: ["account:read"],
      clientId: "client_1",
    });

    const ctx = await resolveMcpAuthContext(
      makeReq({ authorization: "Bearer oauth_jwt" }),
    );
    expect(ctx.kind).toBe("oauth");
    expect(ctx.userId).toBe("user_oauth");
  });

  it("authenticates via Bearer session token when OAuth verify fails", async () => {
    vi.mocked(verifyOAuthAccessToken).mockResolvedValue(null);
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "user_1" },
      session: { activeOrganizationId: "org_2" },
    } as never);

    const ctx = await resolveMcpAuthContext(
      makeReq({ authorization: "Bearer session_token_xyz" }),
    );
    expect(ctx.kind).toBe("session");
    expect(ctx.userId).toBe("user_1");
  });

  it("throws McpAuthError when neither header is present", async () => {
    await expect(resolveMcpAuthContext(makeReq({}))).rejects.toBeInstanceOf(
      McpAuthError,
    );
  });

  it("throws McpAuthError with UNAUTHORIZED code for missing auth", async () => {
    await expect(resolveMcpAuthContext(makeReq({}))).rejects.toMatchObject({
      code: "UNAUTHORIZED",
    });
  });

  it("throws McpAuthError when x-api-key is invalid", async () => {
    vi.mocked(verifyApiKey).mockRejectedValue(
      new ApiKeyError("UNAUTHORIZED", "Invalid key"),
    );
    await expect(
      resolveMcpAuthContext(makeReq({ "x-api-key": "bad_key" })),
    ).rejects.toBeInstanceOf(McpAuthError);
  });

  it("authenticates via Cookie header", async () => {
    vi.mocked(verifyOAuthAccessToken).mockResolvedValue(null);
    vi.mocked(auth.api.getSession).mockResolvedValue({
      user: { id: "user_cookie" },
      session: { activeOrganizationId: null },
    } as never);

    const ctx = await resolveMcpAuthContext(
      makeReq({ cookie: "better-auth.session_token=abc" }),
    );
    expect(ctx.kind).toBe("session");
    expect(ctx.userId).toBe("user_cookie");
  });

  it("throws McpAuthError when Cookie is present but session is invalid", async () => {
    vi.mocked(verifyOAuthAccessToken).mockResolvedValue(null);
    vi.mocked(auth.api.getSession).mockResolvedValue(null);

    await expect(
      resolveMcpAuthContext(makeReq({ cookie: "better-auth.session_token=bad" })),
    ).rejects.toBeInstanceOf(McpAuthError);
  });
});
