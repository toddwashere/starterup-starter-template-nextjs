import { test, expect } from "@playwright/test";
import { signIn } from "./helpers/auth";
import { enterOrg } from "./helpers/org";
import { createContact } from "./helpers/contacts";

const ORG_SLUG = "acme-inc";
const SEED_USER = { email: "user@example.com", password: "password123" };

/**
 * The `chromium` project defaults to the logged-in storageState. The two
 * unauthenticated tests below override it with an empty state.
 */
test.describe("unauthenticated", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  // A1 — protected route redirects to sign-in with a redirectTo back to it.
  test("A1: protected contacts route redirects to sign-in when logged out", async ({
    page,
  }) => {
    await page.goto(`/${ORG_SLUG}/contacts`);

    await expect(page).toHaveURL(/\/sign-in/);
    // redirectTo carries the originally-requested path (URL-encoded).
    await expect(page).toHaveURL(/redirectTo=%2Facme-inc%2Fcontacts/);
  });

  // A2 — signing in lands on the org picker which lists "Acme Inc".
  test("A2: sign-in lands on the org picker showing Acme Inc", async ({ page }) => {
    await signIn(page, SEED_USER);

    await expect(
      page.getByRole("heading", { name: "Your Organizations" }),
    ).toBeVisible();
    await expect(page.getByText("Acme Inc")).toBeVisible();
    await expect(page.getByTestId(`org-picker-${ORG_SLUG}`)).toBeVisible();
  });
});

/**
 * The remaining tests run authenticated via the default storageState.
 */
test.describe("authenticated", () => {
  // B1 — selecting an org from the picker enters the in-org app shell.
  test("B1: selecting an org enters the in-org app shell", async ({ page }) => {
    await page.goto("/");
    await enterOrg(page, ORG_SLUG);

    await expect(page).toHaveURL(new RegExp(`/${ORG_SLUG}$`));
    // The in-org app shell is present: the org dashboard heading and the
    // sidebar nav (the "AI Assistant" link lives only in the in-org sidebar).
    await expect(
      page.getByRole("heading", { name: "Organization Dashboard" }),
    ).toBeVisible();
    await expect(page.getByRole("link", { name: "AI Assistant" })).toBeVisible();
  });

  // C1 — core sidebar navigation renders each destination without crashing.
  test("C1: sidebar navigation reaches Contacts, AI, and Members", async ({
    page,
  }) => {
    await page.goto(`/${ORG_SLUG}`);
    // Wait for the sidebar app shell to render before navigating.
    await expect(page.getByRole("link", { name: "AI Assistant" })).toBeVisible();

    // Contacts: top-level item is a collapsible group; click its "All contacts"
    // sub-link. Open the group first if needed.
    await page.getByRole("button", { name: "Contacts" }).click();
    await page.getByRole("link", { name: "All contacts" }).click();
    await expect(page).toHaveURL(new RegExp(`/${ORG_SLUG}/contacts$`));
    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();

    // AI Assistant: a direct top-level link.
    await page.getByRole("link", { name: "AI Assistant" }).click();
    await expect(page).toHaveURL(new RegExp(`/${ORG_SLUG}/ai$`));
    await expect(
      page.getByRole("heading", { name: "AI Assistant" }),
    ).toBeVisible();

    // Settings -> Members: open the Settings group, then click Members.
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("link", { name: "Members" }).click();
    await expect(page).toHaveURL(new RegExp(`/${ORG_SLUG}/settings/members$`));
    await expect(
      page.getByRole("heading", { name: "Members" }),
    ).toBeVisible();
  });

  // D1 — the contacts page renders with its heading and the add button.
  test("D1: contacts page renders", async ({ page }) => {
    await page.goto(`/${ORG_SLUG}/contacts`);

    await expect(page.getByRole("heading", { name: "Contacts" })).toBeVisible();
    await expect(page.getByTestId("contacts-add")).toBeVisible();
  });

  // D2 — creating a contact shows it in the list.
  test("D2: create a contact and see it in the list", async ({ page }) => {
    const name = `E2E Contact ${Date.now()}`;
    await page.goto(`/${ORG_SLUG}/contacts`);

    await createContact(page, { displayName: name });

    // The flow navigates to the detail page; go back to the list and confirm
    // the new contact appears there too.
    await page.goto(`/${ORG_SLUG}/contacts`);
    await page.getByPlaceholder("Search contacts…").fill(name);
    await expect(page.getByText(name).first()).toBeVisible();
  });

  // D3 — opening a contact row navigates to its detail page.
  test("D3: open a contact and view its detail page", async ({ page }) => {
    // Create a fresh contact so a known row exists regardless of seed state.
    const name = `E2E Open ${Date.now()}`;
    await page.goto(`/${ORG_SLUG}/contacts`);
    await createContact(page, { displayName: name });

    // Back to the list, filter to our contact so contact-row-0 is it. The
    // search input is debounced (~300ms) and the list reloads, so wait until
    // the first visible row is actually our contact before clicking.
    await page.goto(`/${ORG_SLUG}/contacts`);
    await page.getByPlaceholder("Search contacts…").fill(name);

    // The contact-row testid exists on BOTH the desktop table row and the
    // hidden mobile card. Scope to the visible (desktop) one.
    const visibleRow = page
      .getByTestId("contact-row-0")
      .and(page.locator(":visible"));
    // Wait for the filtered result: the first visible row must contain the name.
    await expect(visibleRow).toContainText(name);
    await visibleRow.click();

    await expect(page).toHaveURL(/\/contacts\/[^/]+$/);
    await expect(page.getByRole("heading", { name }).first()).toBeVisible();
  });

  // E8 (fallback for E4) — billing page renders its plan/pricing section
  // without redirecting to Stripe.
  //
  // E4 (create an API key) was attempted but the org API-key create flow is
  // broken on the server: `createOrgApiKeyAction` calls
  // `auth.api.createApiKey({ body })` WITHOUT forwarding request `headers`
  // (unlike every other Better Auth call in api-key-actions.ts), so the create
  // throws a Server Components render error and the modal never reaches the
  // "Done"/one-time-key state. That is an app-source bug (out of scope to fix),
  // so per the task instructions we fall back to E8.
  test("E8: billing page renders the plan section without a Stripe redirect", async ({
    page,
  }) => {
    await page.goto(`/${ORG_SLUG}/settings/billing`);

    // Heading renders.
    await expect(page.getByRole("heading", { name: "Billing" })).toBeVisible();

    // The plan card resolves after the (Stripe-backed) billing queries settle,
    // which can take several seconds, so allow a generous timeout. Either the
    // "Current plan: Free" card or an active-subscription card shows; both
    // contain "Plan limits". Assert the plan/pricing section is present.
    await expect(
      page.getByText(/Current plan|Plan limits|subscription/i).first(),
    ).toBeVisible({ timeout: 20_000 });

    // We must NOT have been redirected off to Stripe — still on the billing URL.
    await expect(page).toHaveURL(
      new RegExp(`/${ORG_SLUG}/settings/billing$`),
    );
  });
});
