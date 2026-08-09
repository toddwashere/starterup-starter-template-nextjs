import { defineConfig } from "vitest/config";

/**
 * `infra/` is not a pnpm workspace package (see pnpm-workspace.yaml), so
 * `turbo run test` never reaches it and these suites silently did not run in
 * CI. They are invoked explicitly via the root `pnpm test:infra` script.
 *
 * `infra/shared/policies` has its own package + suite and is run separately by
 * .github/workflows/infra-policy.yml, so it is excluded here.
 */
export default defineConfig({
  test: {
    // Run by `pnpm test:infra`, which the "Infra AWS" workflow invokes BEFORE
    // any `pulumi up`. It is deliberately NOT part of the main CI workflow:
    // infra changes rarely, so re-running these on every application PR buys
    // nothing.
    //
    // `aws/**` is included: the Infra AWS workflow installs infra/aws's own
    // package.json (which carries @pulumi/*), so those layers resolve there.
    // gcp/** and shared/policies/** stay out: nothing installs their per-layer
    // deps. policies has its own job in infra-policy.yml.
    include: ["shared/**/*.test.ts", "scripts/**/*.test.ts", "aws/**/*.test.ts"],
    exclude: [
      "**/node_modules/**",
      "shared/policies/**",
      "gcp/**",
      "**/dist/**",
    ],
    root: __dirname,
  },
});
