export type ToolResult = {
  toolName: string;
  arguments: Record<string, unknown>;
  result: unknown;
};

export type ChatMessage = {
  /** Database row id (aimsg_…). For optimistic/local messages an ephemeral string is fine. */
  id: string;
  role: "user" | "assistant";
  content: string;
  toolResults?: ToolResult[];
  /** Feedback set by the user on assistant messages. Null means no feedback yet. */
  feedback?: "helpful" | "not_helpful" | null;
};
