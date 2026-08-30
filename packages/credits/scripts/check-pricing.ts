/**
 * Pricing coverage check for `credits.config.ts`.
 *
 * `unknownModelBehavior: "use_default_pricing"` means an uncovered model still
 * bills, silently, at default weights. This check makes that gap visible: every
 * model the AI catalog offers must have an explicit pricing entry, and every
 * pricing entry must correspond to a model that still exists.
 *
 * Run with `pnpm --filter @workspace/credits check:pricing`.
 */
import { AI_CALL_PRESETS, AI_MODELS_BY_PROVIDER } from "@workspace/ai/ai-models-available";
import { creditsConfig } from "../credits.config";

const WEIGHT_FIELDS = [
  "inputTokenWeight",
  "outputTokenWeight",
  "cachedInputTokenWeight",
  "reasoningTokenWeight",
] as const;

const errors: string[] = [];

function isNonNegativeInteger(value: unknown): boolean {
  return typeof value === "number" && Number.isInteger(value) && value >= 0;
}

const pricedModels = creditsConfig.modelPricing.models as Record<
  string,
  Record<string, number | undefined>
>;

// 1. Every catalog model needs explicit pricing.
const catalogModels = Object.entries(AI_MODELS_BY_PROVIDER).flatMap(([provider, models]) =>
  models.map((model) => `${provider}:${model.id}`),
);

for (const providerModel of catalogModels) {
  if (!(providerModel in pricedModels)) {
    errors.push(`${providerModel} is in the AI catalog but has no entry in modelPricing.models`);
  }
}

// 2. Every configured AI call preset needs explicit pricing.
for (const [presetName, preset] of Object.entries(AI_CALL_PRESETS)) {
  if (!(preset.providerModel in pricedModels)) {
    errors.push(
      `AI_CALL_PRESETS.${presetName} uses ${preset.providerModel}, which has no pricing entry`,
    );
  }
}

// 3. No pricing entries for models the catalog no longer offers.
for (const providerModel of Object.keys(pricedModels)) {
  if (!catalogModels.includes(providerModel)) {
    errors.push(`modelPricing.models has a stale entry for ${providerModel} (not in the catalog)`);
  }
}

// 4. Weights and markups must be non-negative integers — no decimal pricing.
for (const [providerModel, pricing] of Object.entries(pricedModels)) {
  for (const field of WEIGHT_FIELDS) {
    const value = pricing[field];
    if (value !== undefined && !isNonNegativeInteger(value)) {
      errors.push(`${providerModel}.${field} must be a non-negative integer`);
    }
  }
  const markup = pricing.markupBasisPoints;
  if (markup !== undefined && !isNonNegativeInteger(markup)) {
    errors.push(`${providerModel}.markupBasisPoints must be a non-negative integer`);
  }
}

// 5. The default pricing fallback must be fully specified.
for (const field of [...WEIGHT_FIELDS, "markupBasisPoints"] as const) {
  if (!isNonNegativeInteger(creditsConfig.modelPricing.defaultModel[field])) {
    errors.push(`modelPricing.defaultModel.${field} must be a non-negative integer`);
  }
}

if (!isNonNegativeInteger(creditsConfig.policy.defaultMarkupBasisPoints)) {
  errors.push("policy.defaultMarkupBasisPoints must be a non-negative integer");
}

// 6. Top-up products must grant positive integer credits under unique keys.
const seenNames = new Set<string>();
const seenPriceEnvVars = new Set<string>();

for (const product of creditsConfig.topUpProducts) {
  if (!Number.isInteger(product.credits) || product.credits <= 0) {
    errors.push(`topUpProducts.${product.name}.credits must be a positive integer`);
  }
  if (seenNames.has(product.name)) {
    errors.push(`topUpProducts has a duplicate product name: ${product.name}`);
  }
  if (seenPriceEnvVars.has(product.stripePriceIdEnvVar)) {
    errors.push(
      `topUpProducts has a duplicate Stripe price env var: ${product.stripePriceIdEnvVar}`,
    );
  }
  seenNames.add(product.name);
  seenPriceEnvVars.add(product.stripePriceIdEnvVar);
}

if (errors.length > 0) {
  console.error(`Credit pricing check failed:\n${errors.map((e) => `- ${e}`).join("\n")}`);
  process.exit(1);
}

console.log(
  `Credit pricing check passed (${catalogModels.length} catalog models priced, version ${creditsConfig.modelPricing.version}).`,
);
