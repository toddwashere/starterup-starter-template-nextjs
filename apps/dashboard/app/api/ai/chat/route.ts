import type { UIMessage, ModelMessage } from "ai";
import { requireUser } from "@workspace/auth/guards";
import { getCurrentOrg } from "@workspace/auth/session";
import { askAssistantChat } from "@workspace/ai/ai-calls/assistant-chat";
import { keys } from "@workspace/ai/keys";
import { getDefaultAvailableProviderModel } from "@workspace/ai/list-available-ai-models";
import {
  DEFAULT_PROVIDER_MODEL,
  type ProviderModelValue,
} from "@workspace/ai/ai-models-available";
import {
  createAiAssistantMessage,
  createAiUserMessage,
  listAiMessagesForThread,
} from "@workspace/ai/data-models/ai-message-repo";
import { getOrCreateActiveAiThread } from "@workspace/ai/data-models/ai-thread-repo";
import { listMcpToolsAction } from "@/features/ai-chat/data/ai-chat-actions";
import { buildToolsFromMcpList } from "@/features/ai-chat/data/mcp-agent-tools";
import { executeMcpTool } from "@/features/ai-chat/data/mcp-tool-executor";
import { formatToolSummary } from "@/features/ai-chat/data/format-tool-summary";

// Node runtime required — Prisma needs Node.js (not edge)
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  // 1. Parse body
  const { messages, providerModel }: {
    messages: UIMessage[];
    providerModel?: string | null;
  } = await req.json();

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
    return Response.json({ error: "No active organization" }, { status: 400 });
  }

  const userId = session.user.id;

  // 3. Choose the model: the client's selection, else the first configured
  // default. askAssistantChat revalidates it (catalog + keys) and 400s below.
  const config = keys();
  const requested = (providerModel ||
    getDefaultAvailableProviderModel(config) ||
    DEFAULT_PROVIDER_MODEL) as ProviderModelValue;

  // 4. Get or create the active thread for this user/org
  const thread = await getOrCreateActiveAiThread(userId, activeOrganizationId);

  // 5. Persist the latest user message
  const lastUserMessage = [...messages].reverse().find((m) => m.role === "user");
  if (lastUserMessage) {
    const text = lastUserMessage.parts
      .filter((p) => p.type === "text")
      .map((p) => (p as { type: "text"; text: string }).text)
      .join("");
    if (text.trim()) {
      await createAiUserMessage(thread.id, activeOrganizationId, userId, text);
    }
  }

  // 6. Build the model context from persisted DB history (not the client's
  // message array) so context stays server-authoritative and consistent with
  // what loadChatThreadAction renders on reload.
  const history = await listAiMessagesForThread(
    thread.id,
    activeOrganizationId,
    userId,
  );
  const modelMessages: ModelMessage[] = history.flatMap((m): ModelMessage[] =>
    m.role === "user"
      ? [{ role: "user", content: m.content }]
      : m.role === "assistant"
        ? [{ role: "assistant", content: m.content }]
        : [],
  );

  // 7. Build tools from MCP and assemble prompt variables.
  const cookie = req.headers.get("cookie") ?? "";
  const mcpTools = await listMcpToolsAction();
  const tools = buildToolsFromMcpList(mcpTools, (name, args) =>
    executeMcpTool(cookie, name, args),
  );
  const toolSummary = formatToolSummary(mcpTools);

  const org = await getCurrentOrg();
  const orgName = org?.name ?? "your organization";

  // 8. Delegate to the assistant-chat call. It renders the prompt, resolves +
  // validates the model, logs, and streams. Invalid model selections reject and
  // are surfaced as a 400.
  let result: Awaited<ReturnType<typeof askAssistantChat>>;
  try {
    result = await askAssistantChat({
      messages: modelMessages,
      tools,
      variables: { orgName, ...(toolSummary ? { toolSummary } : {}) },
      overrides: { providerModel: requested },
      context: {
        userId,
        orgId: activeOrganizationId,
        sessionId: thread.id,
      },
      onFinish: async ({ text, steps }) => {
        try {
          // Steps carry typed tool calls/results at runtime; the call command's
          // onFinish type erases them, so narrow to the shape we persist.
          const typedSteps = steps as Array<{
            toolCalls: Array<{
              toolName: string;
              toolCallId: string;
              input: unknown;
            }>;
            toolResults: Array<{ toolCallId: string; output: unknown }>;
          }>;

          const toolPayload =
            typedSteps.length > 0
              ? typedSteps.flatMap((step) =>
                  step.toolCalls.map((call) => {
                    const toolResult = step.toolResults.find(
                      (r) => r.toolCallId === call.toolCallId,
                    );
                    return {
                      toolName: call.toolName,
                      arguments: call.input as Record<string, unknown>,
                      result: toolResult ? toolResult.output : null,
                    };
                  }),
                )
              : undefined;

          await createAiAssistantMessage(
            thread.id,
            activeOrganizationId,
            userId,
            text,
            {
              toolPayload:
                toolPayload && toolPayload.length > 0 ? toolPayload : undefined,
              metadata: { providerModel: requested },
            },
          );
        } catch (err) {
          // Persistence failure must not crash the stream
          console.error("[ai/chat] Failed to persist assistant message:", err);
        }
      },
    });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Invalid model" },
      { status: 400 },
    );
  }

  // 9. Return UI message stream
  return result.toUIMessageStreamResponse();
}
