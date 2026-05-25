import type { ApiKeyContext } from "../api-keys/verify";

export type PublicApiAuthContext =
  | {
      kind: "oauth";
      userId: string;
      orgId: string | null;
      scopes: string[];
      clientId: string | null;
    }
  | ({ kind: "api-key" } & ApiKeyContext);

export class PublicApiOrgError extends Error {
  constructor(
    public readonly code: "FORBIDDEN" | "BAD_REQUEST",
    message: string,
  ) {
    super(message);
    this.name = "PublicApiOrgError";
  }
}
