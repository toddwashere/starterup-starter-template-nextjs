import { describe, it, expect, vi } from "vitest";
import { getTestInstance } from "better-auth/test";
import { organization } from "better-auth/plugins";
import { organizationClient } from "better-auth/client/plugins";
import { ac, orgRoles } from "./org-roles";
import {
  createEmailAndPasswordOptions,
  createEmailVerificationOptions,
} from "./auth-email-lifecycle";

vi.mock("./email-routing", () => ({
  routeVerificationEmail: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("@workspace/email/send-password-reset-email", () => ({
  sendPasswordResetEmail: vi.fn().mockResolvedValue(undefined),
}));

describe("createOrganization", () => {
  it("returns BAD_REQUEST when slug is already taken", async () => {
    const email = `org-dupe-${Date.now()}@example.com`;
    const password = "password123";

    const { auth, runWithUser } = await getTestInstance({
      emailVerification: createEmailVerificationOptions(),
      emailAndPassword: createEmailAndPasswordOptions(),
      plugins: [organization({ ac, roles: orgRoles })],
      clientOptions: {
        plugins: [organizationClient({ ac, roles: orgRoles })],
      },
    });

    await auth.api.signUpEmail({
      body: { email, password, name: "Dupe User" },
    });

    await runWithUser(email, password, async (headers) => {
      const slug = `dupe-org-${Date.now()}`;

      await auth.api.createOrganization({
        body: { name: "First Org", slug },
        headers,
      });

      await expect(
        auth.api.createOrganization({
          body: { name: "Second Org", slug },
          headers,
        }),
      ).rejects.toMatchObject({
        status: "BAD_REQUEST",
        body: { message: "Organization already exists" },
      });
    });
  });
});
