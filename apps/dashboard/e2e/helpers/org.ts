import { type Page, expect } from "@playwright/test";

/**
 * From the org picker ("Your Organizations"), select an organization and land
 * on its in-org home (`/<slug>`).
 *
 * Assumes the caller is already on the org-picker page (e.g. after `goto("/")`
 * while authenticated). Clicking the org card calls `setActive` then routes to
 * the org home, so we wait for the URL to settle on `/<slug>`.
 */
export async function enterOrg(page: Page, slug = "acme-inc"): Promise<void> {
  await expect(page.getByTestId(`org-picker-${slug}`)).toBeVisible();
  await page.getByTestId(`org-picker-${slug}`).click();

  // The org home is `/<slug>` exactly (no trailing segment).
  await expect(page).toHaveURL(new RegExp(`/${slug}$`));
}
