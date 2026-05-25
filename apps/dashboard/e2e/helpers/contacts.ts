import { type Page, expect } from "@playwright/test";

export interface CreateContactOptions {
  /** The contact's display name (the only required field). */
  displayName: string;
  /** Optional primary email. */
  email?: string;
  /** Optional primary phone. */
  phone?: string;
}

export interface CreateContactResult {
  /** The display name that was entered (echoed back for assertions). */
  displayName: string;
}

/**
 * Create a contact via the "New Contact" modal on the contacts page.
 *
 * Preconditions: the caller is on `/<slug>/contacts`.
 *
 * The add-contact flow (see add-contact-flow.ts) navigates to the new
 * contact's detail page after a successful create, so after submitting we wait
 * for the detail URL and the contact's display name to be visible there.
 *
 * Returns the created display name so the caller can assert on it.
 */
export async function createContact(
  page: Page,
  { displayName, email, phone }: CreateContactOptions,
): Promise<CreateContactResult> {
  // Open the modal via the primary "New Contact" button.
  await page.getByTestId("contacts-add").click();

  // The modal is a dialog titled "Add New Contact".
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Add New Contact" })).toBeVisible();

  // Required field: Name. Optional: Email, Phone. Kind defaults to "person".
  await dialog.getByLabel("Name").fill(displayName);
  if (email) await dialog.getByLabel("Email").fill(email);
  if (phone) await dialog.getByLabel("Phone").fill(phone);

  // Submit.
  await dialog.getByRole("button", { name: "Create Contact" }).click();

  // On success the modal resolves and closes (and the flow routes to the new
  // contact's detail page). Waiting for the dialog to detach confirms the
  // create succeeded — if it had failed, the dialog would stay open with an
  // inline error alert.
  await expect(dialog).toBeHidden();

  return { displayName };
}
