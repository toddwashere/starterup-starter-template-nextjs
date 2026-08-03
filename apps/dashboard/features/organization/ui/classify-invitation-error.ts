export type InvitationErrorKind =
  | "wrong_recipient"
  | "email_verification"
  | "inviter_left"
  | "invalid";

function errorText(error: unknown): string {
  if (!error) {
    return "";
  }
  if (typeof error === "string") {
    return error;
  }
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === "object") {
    const record = error as { message?: unknown; code?: unknown };
    const parts = [record.code, record.message]
      .filter((part): part is string => typeof part === "string")
      .join(" ");
    return parts;
  }
  return String(error);
}

export function classifyInvitationError(error: unknown): InvitationErrorKind {
  const text = errorText(error).toLowerCase();

  if (
    text.includes("you_are_not_the_recipient") ||
    text.includes("not the recipient")
  ) {
    return "wrong_recipient";
  }

  if (
    text.includes("email_verification_required") ||
    text.includes("email verification required")
  ) {
    return "email_verification";
  }

  if (
    text.includes("inviter_is_no_longer") ||
    text.includes("inviter is no longer")
  ) {
    return "inviter_left";
  }

  return "invalid";
}
