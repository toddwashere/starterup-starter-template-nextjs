"use client";

import { useState, useEffect, useRef } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, isToolUIPart } from "ai";
import type { UIMessage } from "ai";
import { Button } from "@workspace/ui/components/button";
import { Input } from "@workspace/ui/components/input";
import { Page, PageBody } from "@workspace/ui/components/page";
import { PageHeaderInOrg } from "@/common/ui/page-header-in-org";
import { ToolResultCard } from "./tool-result-card";
import { MessageFeedback } from "./message-feedback";
import { loadChatThreadAction } from "../data/ai-chat-actions";
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
  const { messages, sendMessage, status, setMessages } = useChat({
    transport: new DefaultChatTransport({ api: "/api/ai/chat" }),
  });

  const [input, setInput] = useState("");

  const isActive = status === "streaming" || status === "submitted";

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
    }

    prevStatusRef.current = status;
  }, [status, setMessages]);

  // ------------------------------------------------------------------
  // Send handler
  // ------------------------------------------------------------------
  function handleSend() {
    if (!input.trim() || isActive) return;
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
          <div className="flex-1 space-y-4 overflow-y-auto p-4">
            {messages.length === 0 && (
              <p className="mt-8 text-center text-sm text-muted-foreground">
                Send a message to interact with AI tools.
              </p>
            )}
            {messages.map((msg) => (
              <UiMessageItem key={msg.id} message={msg} />
            ))}
            {status === "error" && (
              <p className="text-center text-sm text-destructive">
                Something went wrong. Please try again.
              </p>
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
              disabled={isActive}
            />
            <Button
              onClick={handleSend}
              disabled={!input.trim() || isActive}
            >
              {isActive ? "…" : "Send"}
            </Button>
          </div>
        </div>
      </PageBody>
    </Page>
  );
}
