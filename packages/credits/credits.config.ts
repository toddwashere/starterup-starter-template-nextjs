export const creditsConfig = {
  policy: {
    // TEMPORARY: flipped to true to exercise the real charging path end to end.
    // Revert to false before shipping — with this on, any org whose total balance
    // is <= 0 is blocked from AI chat, metered MCP tools, and metered API routes.
    chargeToOrgDefault: true,
    allowOverdraftOnSuccessfulUsage: true,
    blockWhenBalanceCreditsLessThanOrEqualTo: 0,
    missingUsageBehavior: "record_unmetered_no_charge",
    spendOrder: ["monthly_allowance", "wallet"],
    defaultMarkupBasisPoints: 12_500,
  },
  modelPricing: {
    version: "2026-08-29",
    unknownModelBehavior: "use_default_pricing",
    defaultModel: {
      inputTokenWeight: 1,
      outputTokenWeight: 4,
      cachedInputTokenWeight: 0,
      reasoningTokenWeight: 8,
      markupBasisPoints: 12_500,
    },
    models: {
      "openrouter:openai/gpt-4o-mini": {
        inputTokenWeight: 1,
        outputTokenWeight: 4,
      },
      "openai:gpt-4o-mini": {
        inputTokenWeight: 1,
        outputTokenWeight: 4,
      },
      "openai:gpt-4o": {
        inputTokenWeight: 5,
        outputTokenWeight: 15,
      },
      "openrouter:anthropic/claude-sonnet-4": {
        inputTokenWeight: 3,
        outputTokenWeight: 15,
      },
      "anthropic:claude-sonnet-4-20250514": {
        inputTokenWeight: 3,
        outputTokenWeight: 15,
      },
      "bedrock:anthropic.claude-sonnet-5": {
        inputTokenWeight: 3,
        outputTokenWeight: 15,
      },
      "bedrock:anthropic.claude-3-haiku-20240307-v1:0": {
        inputTokenWeight: 1,
        outputTokenWeight: 5,
      },
      "ollama:llama3.2": {
        inputTokenWeight: 0,
        outputTokenWeight: 0,
        cachedInputTokenWeight: 0,
        reasoningTokenWeight: 0,
        markupBasisPoints: 10_000,
      },
      "openai-compatible:local-model": {
        inputTokenWeight: 1,
        outputTokenWeight: 4,
      },
    },
  },
  topUpProducts: [
    {
      name: "starter_pack",
      displayName: "Starter Pack",
      credits: 100_000,
      stripePriceIdEnvVar: "STRIPE_PRICE_CREDITS_STARTER",
      isActive: true,
      sortOrder: 0,
    },
  ],
} as const;
