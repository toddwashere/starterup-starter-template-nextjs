"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import type { ProviderModelValue } from "@workspace/ai/ai-models-available";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Page, PageBody } from "@workspace/ui/components/page";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import { ToolResultCard } from "./tool-result-card";
import { MessageFeedback } from "./message-feedback";
import { AiProviderModelSelect } from "./ai-provider-model-select";
import type { ProviderModelSelectOption } from "./ai-provider-model-select-utils";
import {
  listAvailableAiModelsAction,
  loadChatThreadAction,
} from "../data/ai-chat-actions";
import {
  getAiChatCreditStatusAction,
  type AiChatCreditStatus,
} from "../data/ai-chat-credit-actions";
import type { ChatMessage, ToolResult } from "../data/ai-chat-types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Convert a ChatMessage (from DB history) to a UIMessage for useChat.
 * DB ids are preserved so feedback can reference them immediately.
 */
function toUIMessage(m: ChatMessage): UIMessage {
  return {
    id: m.id,
    role: m.role,
    parts: [{ type: "text", text: m.content }],
  } as UIMessage;
}

/**
 * Extract plain text from a UIMessage by joining all text parts.
 */
function extractText(msg: UIMessage): string {
  return msg.parts
    .filter((p): p is { type: "text"; text: string } => p.type === "text")
    .map((p) => p.text)
    .join("");
}

// ---------------------------------------------------------------------------
// Message item — renders a single UIMessage
// ---------------------------------------------------------------------------

function UiMessageItem({ message }: { message: UIMessage }) {
  const isUser = message.role === "user";

  // Collect tool parts for rendering
  const toolParts = message.parts.filter(isToolUIPart);

  // Adapt tool parts into the ToolResult shape for ToolResultCard
  const toolResults: ToolResult[] = toolParts
    .filter((tp) => tp.state === "output-available" || tp.state === "output-error")
    .map((tp) => {
      // toolName is embedded in the type field: `tool-${name}` or via DynamicToolUIPart
      const toolName =
        "toolName" in tp
          ? (tp as { toolName: string }).toolName
          : tp.type.startsWith("tool-")
            ? tp.type.slice(5)
            : tp.type;

      return {
        toolName,
        arguments: (tp.input as Record<string, unknown> | undefined) ?? {},
        result:
          tp.state === "output-available"
            ? tp.output
            : (tp as { errorText?: string }).errorText ?? "error",
      };
    });

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[80%] space-y-2 ${isUser ? "items-end" : "items-start"}`}
      >
        <div
          className={`rounded-lg px-4 py-2 text-sm ${
            isUser
              ? "bg-primary text-primary-foreground"
              : "bg-muted"
          }`}
        >
          {extractText(message) || (toolParts.length > 0 ? null : " ")}
        </div>

        {toolResults.map((tr, i) => (
          <ToolResultCard key={i} result={tr} />
        ))}

        {/* Show in-progress tool calls (streaming / input-available but not yet done) */}
        {toolParts
          .filter(
            (tp) =>
              tp.state === "input-streaming" || tp.state === "input-available",
          )
          .map((tp, i) => {
            const toolName =
              "toolName" in tp
                ? (tp as { toolName: string }).toolName
                : tp.type.startsWith("tool-")
                  ? tp.type.slice(5)
                  : tp.type;
            return (
              <div
                key={i}
                className="border rounded p-3 bg-muted/30 text-sm font-mono text-xs text-muted-foreground"
              >
                Calling {toolName}…
              </div>
            );
          })}

        {/* Feedback buttons on assistant messages — only if the message has a DB id */}
        {!isUser && message.id.startsWith("aimsg_") && (
          <MessageFeedback messageId={message.id} />
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Page content
// ---------------------------------------------------------------------------

export function AiChatPageContent() {
  const [providerModel, setProviderModel] = useState<ProviderModelValue | null>(
    null,
  );
  const [modelOptions, setModelOptions] = useState<ProviderModelSelectOption[]>(
    [],
  );
  const [modelsError, setModelsError] = useState<string | null>(null);
  const [creditStatus, setCreditStatus] = useState<AiChatCreditStatus | null>(
    null,
  );

  // Send the selected model on every request. Recreating the transport when the
  // selection changes keeps the request body in sync without a stale closure.
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/ai/chat",
        body: { providerModel },
      }),
    [providerModel],
  );

  const { messages, sendMessage, status, setMessages, error } = useChat({
    transport,
  });

  const [input, setInput] = useState("");

  const isActive = status === "streaming" || status === "submitted";
  const canChat = providerModel !== null;

  // ------------------------------------------------------------------
  // Load available models on mount and preselect the default
  // ------------------------------------------------------------------
  useEffect(() => {
    listAvailableAiModelsAction().then((res) => {
      if (res.success) {
        setModelOptions(res.data.models);
        setProviderModel(res.data.defaultValue);
        setModelsError(null);
      } else {
        setModelsError(res.error);
      }
    });
  }, []);

  // ------------------------------------------------------------------
  // Credit balance for the header. Returns null when the chat credit UI is
  // disabled in dashboard.config.ts, so nothing renders in that case.
  // ------------------------------------------------------------------
  const refreshCreditStatus = useCallback(() => {
    getAiChatCreditStatusAction().then((res) => {
      setCreditStatus(res.success ? res.data : null);
    });
  }, []);

  useEffect(() => {
    refreshCreditStatus();
  }, [refreshCreditStatus]);

  // ------------------------------------------------------------------
  // Hydrate history on mount from the DB
  // ------------------------------------------------------------------
  useEffect(() => {
    loadChatThreadAction().then((res) => {
      if (res.success && res.data.messages.length > 0) {
        setMessages(res.data.messages.map(toUIMessage));
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ------------------------------------------------------------------
  // Refresh messages from DB after streaming finishes so assistant messages
  // carry real DB ids (for feedback). The optimistic useChat ids are NOT
  // the aimsg_… ids stored in the database.
  //
  // v1 note: full streamed-message-id plumbing (injecting the DB id into the
  // stream at the route level) is a v1 follow-up; this refresh-after-finish
  // approach is the pragmatic v1 solution.
  // ------------------------------------------------------------------
  const prevStatusRef = useRef(status);
  useEffect(() => {
    const wasActive =
      prevStatusRef.current === "streaming" ||
      prevStatusRef.current === "submitted";
    const isNowReady = status === "ready";

    if (wasActive && isNowReady) {
      loadChatThreadAction().then((res) => {
        if (res.success) {
          setMessages(res.data.messages.map(toUIMessage));
        }
      });
      // Usage settles in the route's onFinish, so re-read the balance here.
      refreshCreditStatus();
    }

    prevStatusRef.current = status;
  }, [status, setMessages, refreshCreditStatus]);

  // ------------------------------------------------------------------
  // Send handler
  // ------------------------------------------------------------------
  function handleSend() {
    if (!input.trim() || isActive || !canChat) return;
    void sendMessage({ text: input });
    setInput("");
  }

  return (
    <Page className="flex min-h-0 flex-1 flex-col">
      <PageHeaderInOrg
        title="AI Assistant"
        description="Send messages and run MCP tools with your current organization session."
      />
      <PageBody
        disableScroll
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          {(creditStatus || (modelOptions.length > 0 && providerModel)) && (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-b px-4 py-2">
              {creditStatus && (
                <span
                  className="mr-auto text-xs text-muted-foreground"
                  data-testid="ai-chat-credit-balance"
                >
                  {creditStatus.totalBalanceCredits.toLocaleString()} credits
                </span>
              )}
              <span className="text-xs text-muted-foreground">Model</span>
              {providerModel && modelOptions.length > 0 && (
                <AiProviderModelSelect
                  value={providerModel}
                  onValueChange={setProviderModel}
                  options={modelOptions}
                  disabled={isActive}
                />
              )}
            </div>
          )}

          {creditStatus?.isLow && (
            <div
              className="shrink-0 border-b bg-muted/40 px-4 py-2 text-xs text-muted-foreground"
              data-testid="ai-chat-low-balance-warning"
            >
              {creditStatus.isExhausted
                ? "Your organization is out of AI credits. Add credits in Billing to keep chatting."
                : `Low AI credit balance (${creditStatus.totalBalanceCredits.toLocaleString()} left). Add credits in Billing to avoid interruptions.`}
            </div>
          )}

          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {modelsError ? (
              <div className="mt-8 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-center text-sm text-destructive">
                {modelsError}
              </div>
            ) : (
              messages.length === 0 && (
                <p className="mt-8 text-center text-sm text-muted-foreground">
                  Send a message to interact with AI tools.
                </p>
              )
            )}
            {messages.map((msg) => (
              <UiMessageItem key={msg.id} message={msg} />
            ))}
            {status === "error" && (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
                <p className="font-medium">Something went wrong</p>
                <p className="mt-1 text-destructive/90">
                  {error?.message ??
                    "The assistant could not respond. Check your AI provider API keys in .env, then restart the dev server."}
                </p>
              </div>
            )}
          </div>

          <div className="flex shrink-0 gap-2 border-t p-4">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask something…"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              disabled={isActive || !canChat}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isActive || !canChat}
            >
              {isActive ? "…" : "Send"}
            </Button>
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
