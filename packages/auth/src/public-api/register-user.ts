import { APIError } from "better-auth/api";
import { auth } from "../auth";
import { PublicApiRegisterError } from "./types";

export { PublicApiRegisterError };

export type RegisterUserInput = {
  name: string;
  email: string;
  password: string;
};

export type RegisteredUser = {
  id: string;
  name: string;
  email: string;
};

const DUPLICATE_EMAIL_MESSAGE =
  "An account with this email already exists. Sign in instead.";

function isDuplicateEmail(err: APIError): boolean {
  if (err.body?.code === "USER_ALREADY_EXISTS") return true;
  return /already exists/i.test(err.message ?? "");
}

export async function registerUserForPublicApi(
  input: RegisterUserInput,
): Promise<RegisteredUser> {
  try {
    const result = await auth.api.signUpEmail({
      body: {
        name: input.name,
        email: input.email,
        password: input.password,
      },
    });
    const { id, name, email } = result.user;
    return { id, name, email };
  } catch (err) {
    if (err instanceof APIError) {
      if (isDuplicateEmail(err)) {
        throw new PublicApiRegisterError(
          "VALIDATION_ERROR",
          DUPLICATE_EMAIL_MESSAGE,
        );
      }
      throw new PublicApiRegisterError("VALIDATION_ERROR", err.message);
    }
    throw err;
  }
}
