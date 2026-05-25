import { test as setup, expect } from "@playwright/test";
import { signIn } from "./helpers/auth";
import { STORAGE_STATE } from "./playwright.config";

setup("authenticate as seed user", async ({ page }) => {
  await signIn(page, { email: "user@example.com", password: "password123" });

  // Confirm we are authenticated by verifying the org picker is shown.
  await expect(page.getByRole("heading", { name: "Your Organizations" })).toBeVisible();

  // Persist session cookies / local-storage for downstream test projects.
  await page.context().storageState({ path: STORAGE_STATE });
});
