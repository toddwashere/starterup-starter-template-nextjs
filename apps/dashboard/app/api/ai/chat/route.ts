import { streamText, stepCountIs } from "ai";
import type { UIMessage, ModelMessage } from "ai";
import { requireUser } from "@workspace/auth/guards";
import { getModel, getGenerationDefaults, buildTelemetryOptions } from "@workspace/ai";
import { ASSISTANT_SYSTEM_PROMPT } from "@workspace/ai/prompts/assistant-system";
import { keys } from "@workspace/ai/keys";
import {
  getOrCreateActiveThread,
  appendUserMessage,
  appendAssistantMessage,
  listMessagesForThread,
} from "@workspace/ai-chat";
import { listMcpToolsAction } from "@/features/ai-chat/data/ai-chat-actions";
import {
  buildToolsFromMcpList,
} from "@/features/ai-chat/data/mcp-agent-tools";
import { executeMcpTool } from "@/features/ai-chat/data/mcp-tool-executor";

// Node runtime required — Prisma needs Node.js (not edge)
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // 1. Parse body
  const { messages }: { messages: UIMessage[] } = await req.json();

  // 2. Auth
  let session: Awaited<ReturnType<typeof requireUser>>;
  try {
    session = await requireUser();
  } catch {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const activeOrganizationId = (
    session.session as { activeOrganizationId?: string | null }
  ).activeOrganizationId;

  if (!activeOrganizationId) {
    return Response.json(
      { error: "No active organization" },
      { status: 400 },
    );
  }

  const userId = session.user.id;

  // 3. Resolve the model — return 503 if AI is not configured
  const model = (() => {
    try {
      return getModel();
    } catch {
      return null;
    }
  })();

  if (!model) {
    return Response.json(
      {
        error:
          "AI is not configured. Set AI_PROVIDER and a provider API key.",
      },
      { status: 503 },
    );
  }

  // 4. Get or create the active thread for this user/org
  const thread = await getOrCreateActiveThread({
    userId,
    organizationId: activeOrganizationId,
  });

  // 5. Persist the latest user message
  const lastUserMessage = [...messages]
    .reverse()
    .find((m) => m.role === "user");

  if (lastUserMessage) {
    const text = lastUserMessage.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("");

    if (text.trim()) {
      await appendUserMessage({
        threadId: thread.id,
        organizationId: activeOrganizationId,
        userId,
        content: text,
      });
    }
  }

  // 6. Build the model context from persisted DB history (not the client's
  // message array). The client could otherwise fabricate prior assistant turns
  // in the context window; sourcing from the DB keeps context server-authoritative
  // and consistent with what loadChatThreadAction renders on reload.
  const history = await listMessagesForThread({
    threadId: thread.id,
    organizationId: activeOrganizationId,
    userId,
  });
  const modelMessages: ModelMessage[] = history.flatMap((m): ModelMessage[] =>
    m.role === "user"
      ? [{ role: "user", content: m.content }]
      : m.role === "assistant"
        ? [{ role: "assistant", content: m.content }]
        : [],
  );

  // 7. Build tools from MCP
  const cookie = req.headers.get("cookie") ?? "";
  const mcpTools = await listMcpToolsAction();
  const tools = buildToolsFromMcpList(
    mcpTools,
    (name, args) => executeMcpTool(cookie, name, args),
  );

  // 8. Stream response
  const result = streamText({
    model,
    system: ASSISTANT_SYSTEM_PROMPT,
    messages: modelMessages,
    tools,
    stopWhen: stepCountIs(keys().AI_AGENT_MAX_STEPS),
    ...getGenerationDefaults(),
    ...buildTelemetryOptions({
      functionId: "ai.chat",
      userId,
      orgId: activeOrganizationId,
      sessionId: thread.id,
    }),
    onFinish: async ({ text, steps }) => {
      try {
        // Build a JSON-serializable tool payload from all steps.
        // TypedToolCall uses `.input`, TypedToolResult uses `.output`.
        const toolPayload =
          steps.length > 0
            ? steps.flatMap((step) =>
                step.toolCalls.map((call) => {
                  const result = step.toolResults.find(
                    (r) => r.toolCallId === call.toolCallId,
                  );
                  return {
                    toolName: call.toolName,
                    // input is typed per-tool; cast to plain object for storage
                    arguments: call.input as Record<string, unknown>,
                    result: result != null ? (result as { output: unknown }).output : null,
                  };
                }),
              )
            : undefined;

        await appendAssistantMessage({
          threadId: thread.id,
          organizationId: activeOrganizationId,
          userId,
          content: text,
          toolPayload:
            toolPayload && toolPayload.length > 0 ? toolPayload : undefined,
          metadata: undefined,
        });
      } catch (err) {
        // Persistence failure must not crash the stream
        console.error("[ai/chat] Failed to persist assistant message:", err);
      }
    },
  });

  // 9. Return UI message stream
  return result.toUIMessageStreamResponse();
}
