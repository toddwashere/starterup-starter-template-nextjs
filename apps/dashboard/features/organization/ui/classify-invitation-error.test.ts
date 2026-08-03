import { describe, expect, it } from "vitest";
import { classifyInvitationError } from "./classify-invitation-error";

describe("classifyInvitationError", () => {
  it("detects wrong recipient from message or code", () => {
    expect(
      classifyInvitationError(
        new Error("You are not the recipient of the invitation"),
      ),
    ).toBe("wrong_recipient");
    expect(
      classifyInvitationError({
        code: "YOU_ARE_NOT_THE_RECIPIENT_OF_THE_INVITATION",
        message: "Forbidden",
      }),
    ).toBe("wrong_recipient");
  });

  it("detects email verification requirement", () => {
    expect(
      classifyInvitationError(
        new Error(
          "Email verification required to view or list invitations for the session email",
        ),
      ),
    ).toBe("email_verification");
  });

  it("detects inviter left organization", () => {
    expect(
      classifyInvitationError(
        new Error("Inviter is no longer a member of the organization"),
      ),
    ).toBe("inviter_left");
  });

  it("defaults unknown errors to invalid", () => {
    expect(classifyInvitationError(new Error("Invitation not found!"))).toBe(
      "invalid",
    );
    expect(classifyInvitationError(null)).toBe("invalid");
  });
});
