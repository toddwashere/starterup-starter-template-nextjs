import { creditsConfig } from "../../credits.config";
import type { AiUsageLike } from "../types";

type ModelPricing = {
  inputTokenWeight: number;
  outputTokenWeight: number;
  cachedInputTokenWeight: number;
  reasoningTokenWeight: number;
  markupBasisPoints: number;
};

function ceilDiv(numerator: number, denominator: number): number {
  return Math.ceil(numerator / denominator);
}

function positiveInteger(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.trunc(value));
}

function resolvePricing(providerModel: string): ModelPricing {
  const configured: Partial<ModelPricing> | undefined =
    creditsConfig.modelPricing.models[
      providerModel as keyof typeof creditsConfig.modelPricing.models
    ];
  return {
    ...creditsConfig.modelPricing.defaultModel,
    ...(configured ?? {}),
    markupBasisPoints:
      "markupBasisPoints" in (configured ?? {})
        ? (configured?.markupBasisPoints ?? creditsConfig.policy.defaultMarkupBasisPoints)
        : creditsConfig.modelPricing.defaultModel.markupBasisPoints,
  };
}

export function normalizeModelUsage(input: { providerModel: string; usage: AiUsageLike }) {
  const pricing = resolvePricing(input.providerModel);
  const inputTokens = positiveInteger(input.usage.inputTokens ?? input.usage.promptTokens);
  const outputTokens = positiveInteger(input.usage.outputTokens ?? input.usage.completionTokens);
  const cachedInputTokens = positiveInteger(input.usage.cachedInputTokens);
  const reasoningTokens = positiveInteger(input.usage.reasoningTokens);
  const markupBasisPoints =
    pricing.markupBasisPoints ?? creditsConfig.policy.defaultMarkupBasisPoints;
  const normalizedTokens =
    inputTokens * pricing.inputTokenWeight +
    outputTokens * pricing.outputTokenWeight +
    cachedInputTokens * pricing.cachedInputTokenWeight +
    reasoningTokens * pricing.reasoningTokenWeight;

  return {
    inputTokens,
    outputTokens,
    cachedInputTokens,
    reasoningTokens,
    normalizedTokens,
    creditsCharged: ceilDiv(normalizedTokens * markupBasisPoints, 10_000),
    pricingVersion: creditsConfig.modelPricing.version,
    markupBasisPoints,
  };
}
