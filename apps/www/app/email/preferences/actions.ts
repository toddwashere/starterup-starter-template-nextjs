"use server";

import {
  getPreferencePageContext,
  unsubscribeAll,
  unsubscribeFromSequence,
  unsubscribeFromToken,
} from "@workspace/campaigns";

type ActionResult<T = void> =
  | { success: true; data: T }
  | { success: false; error: string };

export async function getEmailPreferenceContextAction(
  token: string,
): Promise<
  ActionResult<Awaited<ReturnType<typeof getPreferencePageContext>>>
> {
  try {
    const data = await getPreferencePageContext(token);
    return { success: true, data };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Invalid or expired link",
    };
  }
}

export async function unsubscribeAllMarketingAction(
  token: string,
): Promise<ActionResult> {
  try {
    const context = await getPreferencePageContext(token);
    await unsubscribeAll(context.contactId, context.organizationId);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to unsubscribe",
    };
  }
}

export async function unsubscribeFromSequenceMarketingAction(
  token: string,
): Promise<ActionResult> {
  try {
    const context = await getPreferencePageContext(token);
    if (!context.sequenceId) {
      return { success: false, error: "This link is not valid for sequence unsubscribe" };
    }
    await unsubscribeFromSequence(
      context.contactId,
      context.sequenceId,
      context.organizationId,
    );
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to unsubscribe from sequence",
    };
  }
}

export async function oneClickUnsubscribeAction(token: string): Promise<ActionResult> {
  try {
    await unsubscribeFromToken(token);
    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to unsubscribe",
    };
  }
}
