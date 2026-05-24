import { oauthProviderAuthServerMetadata } from "@better-auth/oauth-provider";
import { auth } from "./auth";

/** RFC 8414 OAuth Authorization Server metadata for the dashboard well-known route. */
export const GET = oauthProviderAuthServerMetadata(auth);
