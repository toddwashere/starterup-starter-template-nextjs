"use server";

import { requireUser } from "@workspace/auth/guards";
import { readMcpJsonRpcResponse } from "@workspace/common/mcp/http-client";
import { getPublicMcpEndpoint } from "@workspace/common/env/public-mcp";
import { headers } from "next/headers";
import {
  getOrCreateActiveThread,
  listMessagesForThread,
  setMessageFeedback,
} from "@workspace/ai-chat";
import { SetMessageFeedbackSchema } from "@workspace/ai-chat/schemas/ai-chat-schemas";
import type { ActionResult } from "@/common/data/action-result";
import type { ChatMessage } from "./ai-chat-types";
import { mcpPost } from "./mcp-tool-executor";

export async function callMcpToolAction(toolName: string, args: Record<string, unknown>) {
  await requireUser();
  const cookie = (await headers()).get("cookie") ?? "";
  const res = await mcpPost(cookie, {
    jsonrpc: "2.0",
    id: Date.now(),
    method: "tools/call",
    params: { name: toolName, arguments: args },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `MCP call failed (${res.status}) at ${getPublicMcpEndpoint()}${text ? `: ${text.slice(0, 200)}` : ""}`,
    );
  }
  return readMcpJsonRpcResponse(res);
}

export async function listMcpToolsAction() {
  await requireUser();
  const cookie = (await headers()).get("cookie") ?? "";
  const res = await mcpPost(cookie, {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/list",
    params: {},
  });
  if (!res.ok) return [];
  const data = (await readMcpJsonRpcResponse(res)) as { result?: { tools?: unknown[] } };
  return data.result?.tools ?? [];
}

// ---------------------------------------------------------------------------
// Chat persistence actions
// ---------------------------------------------------------------------------

/**
 * Resolve the active org and return the active thread with loaded messages.
 *
 * Auth strategy: `requireUser()` + extract `activeOrganizationId` from the
 * session object. We do NOT gate on a specific permission resource because the
 * AI chat feature has no dedicated resource in the access-control schema (v1);
 * every authenticated org member may access their own thread.
 *
 * The repos enforce userId + organizationId scoping, so cross-org reads are
 * impossible even if this action is called without an active org (it errors).
 */
export async function loadChatThreadAction(): Promise<
  ActionResult<{ threadId: string; messages: ChatMessage[] }>
> {
  try {
    const session = await requireUser();
    const activeOrganizationId = (
      session.session as { activeOrganizationId?: string | null }
    ).activeOrganizationId;

    if (!activeOrganizationId) {
      return { success: false, error: "No active organization selected" };
    }

    const userId = session.user.id;

    const thread = await getOrCreateActiveThread({ userId, organizationId: activeOrganizationId });

    const dbMessages = await listMessagesForThread({
      threadId: thread.id,
      organizationId: activeOrganizationId,
      userId,
    });

    const messages: ChatMessage[] = dbMessages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) => {
        const base: ChatMessage = {
          id: m.id,
          role: m.role as "user" | "assistant",
          content: m.content,
          feedback: (m.feedback as "helpful" | "not_helpful" | null) ?? null,
        };

        if (m.role === "assistant" && m.toolPayload != null) {
          try {
            base.toolResults = m.toolPayload as ChatMessage["toolResults"];
          } catch {
            // toolPayload malformed — surface message without tool results
          }
        }

        return base;
      });

    return { success: true, data: { threadId: thread.id, messages } };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to load chat thread",
    };
  }
}

/**
 * Set user feedback on an assistant message.
 *
 * Input is validated with the canonical zod schema from `@workspace/ai-chat`.
 * The repo enforces assistant-only + org/user ownership.
 */
export async function setMessageFeedbackAction(input: {
  messageId: string;
  feedback: "helpful" | "not_helpful";
  comment?: string;
}): Promise<ActionResult> {
  try {
    const parsed = SetMessageFeedbackSchema.safeParse(input);
    if (!parsed.success) {
      return {
        success: false,
        error: parsed.error.issues.map((i) => i.message).join("; "),
      };
    }

    const session = await requireUser();
    const activeOrganizationId = (
      session.session as { activeOrganizationId?: string | null }
    ).activeOrganizationId;

    if (!activeOrganizationId) {
      return { success: false, error: "No active organization selected" };
    }

    const userId = session.user.id;

    await setMessageFeedback({
      messageId: parsed.data.messageId,
      organizationId: activeOrganizationId,
      userId,
      feedback: parsed.data.feedback,
      comment: parsed.data.comment,
    });

    return { success: true, data: undefined };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : "Failed to set message feedback",
    };
  }
}
