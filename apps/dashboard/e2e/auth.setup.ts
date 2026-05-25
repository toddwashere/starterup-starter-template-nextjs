import { test as setup, expect } from "@playwright/test";
import { signIn } from "./helpers/auth";
import { enterOrg } from "./helpers/org";
import { STORAGE_STATE } from "./playwright.config";

setup("authenticate as seed user", async ({ page }) => {
  await signIn(page, { email: "user@example.com", password: "password123" });

  // Confirm we are authenticated by verifying the org picker is shown.
  await expect(page.getByRole("heading", { name: "Your Organizations" })).toBeVisible();

  // Select the seed org so the saved session has an *active organization*.
  // Org-scoped server actions (create contact, create API key, …) require
  // `session.activeOrganizationId`, which is only set by clicking the org
  // card (authClient.organization.setActive). Without this, the persisted
  // storageState is signed-in but has no active org and those mutations fail
  // with "No active organization selected".
  await enterOrg(page, "acme-inc");

  // Persist session cookies / local-storage for downstream test projects.
  await page.context().storageState({ path: STORAGE_STATE });
});
