import { type Page, expect } from "@playwright/test";

export interface SignInOptions {
  email: string;
  password: string;
}

/**
 * Sign in to the dashboard using the email/password form.
 * After a successful sign-in the browser is redirected away from /sign-in
 * and the "Your Organizations" heading should be visible.
 */
export async function signIn(page: Page, { email, password }: SignInOptions): Promise<void> {
  await page.goto("/sign-in");

  // Prefer label-based locators; fall back to id-based if ambiguous.
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);

  await page.getByRole("button", { name: "Sign In" }).click();

  // Wait until we are no longer on the sign-in page.
  await page.waitForURL((url) => !url.pathname.startsWith("/sign-in"));

  // Assert the org picker page has loaded successfully (no reload — soft nav
  // after sign-in should show orgs once `$listOrg` is gated/invalidated).
  await expect(page.getByRole("heading", { name: "Your Organizations" })).toBeVisible();
}
