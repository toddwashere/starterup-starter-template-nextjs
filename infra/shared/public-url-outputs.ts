import { buildPublicUrlEnv, type PublicUrlEnvName } from "./public-urls";

export const PUBLIC_URL_ENV_NAMES: PublicUrlEnvName[] = [
  "sandbox",
  "staging",
  "production",
];

/**
 * The public URLs CI needs, keyed as the workflows consume them.
 *
 * This is the ONLY definition — `.github/workflows/*` must call the CLI in
 * `scripts/print-public-urls.ts` rather than recomputing hostnames in shell.
 * The `NEXT_PUBLIC_*` values become Docker build-args baked into the images, so
 * a drifted shell derivation produces images pointing at hostnames that do not
 * exist, and nothing fails until someone loads the app.
 */
export function publicUrlOutputs(
  root: string,
  env: PublicUrlEnvName,
): Record<string, string> {
  const urls = buildPublicUrlEnv(root, env);
  return {
    dashboard: urls.NEXT_PUBLIC_DASHBOARD_URL,
    www: urls.NEXT_PUBLIC_WWW_URL,
    api: urls.NEXT_PUBLIC_API_URL,
    mcp: urls.NEXT_PUBLIC_MCP_URL,
    auth: urls.BETTER_AUTH_URL,
  };
}

/** `key=value` lines for `>> "$GITHUB_OUTPUT"`. */
export function formatGithubOutputs(outputs: Record<string, string>): string {
  return (
    Object.entries(outputs)
      .map(([key, value]) => {
        if (value.includes("\n")) {
          throw new Error(
            `Refusing to emit ${key}: value contains a newline, which would inject additional GITHUB_OUTPUT entries.`,
          );
        }
        return `${key}=${value}`;
      })
      .join("\n") + "\n"
  );
}
