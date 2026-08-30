import type { ToolCallContext } from "./context";

/** Structural subset of z.ZodTypeAny — avoids a hard zod dependency in this package */
export type ZodLike = {
  _type: unknown;
  _input: unknown;
  _output: unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parse: (v: unknown) => any;
};

export type ToolDefinition<TOutput = unknown> = {
  name: string;
  description: string;
  requiredScopes: string[];
  requiredPermissions: Record<string, string[]>;
  creditPolicy?: {
    chargeToOrg?: boolean;
    usageArea: string;
    cost: { mode: "fixed"; credits: number };
  };
  inputShape?: Record<string, ZodLike>;
  run: (ctx: ToolCallContext, input: Record<string, unknown>) => Promise<TOutput>;
};
