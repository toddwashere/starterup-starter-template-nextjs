// Prints the public URLs for one environment as `key=value` lines, for
// `>> "$GITHUB_OUTPUT"`. Kept as a thin shim so the logic in
// `../public-url-outputs.ts` stays unit-testable without executing this file.
//
//   pnpm infra:public-urls example.com staging
import {
  formatGithubOutputs,
  PUBLIC_URL_ENV_NAMES,
  publicUrlOutputs,
} from "../public-url-outputs";
import type { PublicUrlEnvName } from "../public-urls";

const [root, env] = process.argv.slice(2);

if (!root) {
  console.error("usage: print-public-urls <root-domain> <env>");
  process.exit(1);
}
if (!env || !PUBLIC_URL_ENV_NAMES.includes(env as PublicUrlEnvName)) {
  console.error(
    `env must be one of ${PUBLIC_URL_ENV_NAMES.join(", ")}; got ${env ?? "(none)"}`,
  );
  process.exit(1);
}

process.stdout.write(
  formatGithubOutputs(publicUrlOutputs(root, env as PublicUrlEnvName)),
);
