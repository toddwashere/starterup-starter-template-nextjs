import { describe, it, expect, vi } from "vitest";

vi.mock("@workspace/auth/public-api", () => ({
  registerUserForPublicApi: vi.fn(),
  PublicApiRegisterError: class PublicApiRegisterError extends Error {
    constructor(
      public code: "VALIDATION_ERROR",
      message: string,
    ) {
      super(message);
      this.name = "PublicApiRegisterError";
    }
  },
  getUserProfileForPublicApi: vi.fn(),
  listOrganizationsForUser: vi.fn(),
  assertUserOrgMember: vi.fn(),
  PublicApiOrgError: class PublicApiOrgError extends Error {
    constructor(
      public code: "BAD_REQUEST" | "FORBIDDEN",
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@workspace/auth/api-keys", () => ({
  verifyApiKey: vi.fn(),
  hasPermission: vi.fn(),
  ApiKeyError: class ApiKeyError extends Error {
    constructor(
      public code: "UNAUTHORIZED" | "RATE_LIMITED",
      message: string,
    ) {
      super(message);
    }
  },
}));

vi.mock("@workspace/auth/oauth/verify-access-token", () => ({
  verifyOAuthAccessToken: vi.fn(),
}));

import { createApp } from "../app";

// Minimal shape of the bits of the OpenAPI doc the assertions touch.
type Spec = {
  components?: {
    securitySchemes?: Record<string, unknown>;
    schemas?: Record<string, unknown>;
  };
  paths: Record<
    string,
    Record<
      string,
      {
        tags?: string[];
        responses: Record<
          string,
          { content?: { "application/json"?: { schema?: { $ref?: string } } } }
        >;
      }
    >
  >;
};

async function getSpec(): Promise<Spec> {
  const res = await createApp().request("/openapi.json");
  expect(res.status).toBe(200);
  return (await res.json()) as Spec;
}

describe("/openapi.json spec", () => {
  it("includes the bearerAuth security scheme", async () => {
    const spec = await getSpec();
    expect(spec.components?.securitySchemes?.bearerAuth).toBeDefined();
  });

  it("registers the ErrorResponse schema as a named component", async () => {
    const spec = await getSpec();
    expect(spec.components?.schemas?.ErrorResponse).toBeDefined();
  });

  it("tags routes with Auth, User, and Organization", async () => {
    const spec = await getSpec();
    expect(spec.paths["/v1/auth/register"]?.post?.tags).toContain("Auth");
    expect(spec.paths["/v1/me"]?.get?.tags).toContain("User");
    expect(spec.paths["/v1/orgs/{orgId}/ping"]?.get?.tags).toContain(
      "Organization",
    );
  });

  it("attaches a 400 ErrorResponse to POST /v1/auth/register", async () => {
    const spec = await getSpec();
    const schema =
      spec.paths["/v1/auth/register"]?.post?.responses["400"]?.content?.[
        "application/json"
      ]?.schema;
    expect(schema?.$ref).toBe("#/components/schemas/ErrorResponse");
  });

  it("attaches 401 and 403 ErrorResponses to GET /v1/me", async () => {
    const spec = await getSpec();
    const responses = spec.paths["/v1/me"]?.get?.responses;
    expect(
      responses?.["401"]?.content?.["application/json"]?.schema?.$ref,
    ).toBe("#/components/schemas/ErrorResponse");
    expect(
      responses?.["403"]?.content?.["application/json"]?.schema?.$ref,
    ).toBe("#/components/schemas/ErrorResponse");
  });
});
