export type CreditSource =
  | "dashboard"
  | "public_api"
  | "public_mcp"
  | "worker"
  | "stripe"
  | "system";

export type CreditUsageArea =
  | "assistant_chat"
  | "agent_run"
  | "image_generation"
  | "worker_job"
  | "mcp_tool"
  | "api_route"
  | "monthly_allowance"
  | "stripe_top_up"
  | "admin_adjustment";

export type CreditActor =
  | { kind: "user"; userId: string }
  | { kind: "api_key"; apiKeyId: string; userId?: string | null }
  | { kind: "oauth_client"; oauthClientId: string; userId?: string | null }
  | { kind: "system" };

export type CreditCost = { mode: "fixed"; credits: number };

export type CreditGrantBucket = "monthly_allowance" | "wallet";

export type AiUsageLike = {
  inputTokens?: number;
  outputTokens?: number;
  cachedInputTokens?: number;
  reasoningTokens?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
};
