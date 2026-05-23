"use client";

import { useState } from "react";
import { Button } from "@workspace/ui/components/button";
import {
  IconForThumbsUp,
  IconForThumbsDown,
} from "@workspace/ui/components/icon-for";
import { setMessageFeedbackAction } from "../data/ai-chat-actions";

type Feedback = "helpful" | "not_helpful";

interface MessageFeedbackProps {
  /** The database message id (aimsg_…). Must be a real DB id — optimistic ids are not valid here. */
  messageId: string;
}

/**
 * Thumbs up/down feedback buttons for assistant messages.
 *
 * v1 limitation: the message id must be a database id (aimsg_…), not the
 * optimistic id assigned by useChat during streaming. The parent component
 * refreshes messages from the DB after streaming finishes so these buttons
 * receive the real ids. Full streamed-message-id plumbing is a v1 follow-up.
 */
export function MessageFeedback({ messageId }: MessageFeedbackProps) {
  const [selected, setSelected] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(false);

  async function handleFeedback(feedback: Feedback) {
    if (pending || selected === feedback) return;
    setPending(true);
    try {
      await setMessageFeedbackAction({ messageId, feedback });
      setSelected(feedback);
    } catch {
      // Silently ignore — feedback is best-effort
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="flex items-center gap-1 mt-1">
      <Button
        variant="ghost"
        size="sm"
        className={`h-6 w-6 p-0 ${selected === "helpful" ? "text-green-600" : "text-muted-foreground"}`}
        onClick={() => void handleFeedback("helpful")}
        disabled={pending}
        title="Helpful"
        aria-label="Mark as helpful"
      >
        <IconForThumbsUp />
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`h-6 w-6 p-0 ${selected === "not_helpful" ? "text-red-600" : "text-muted-foreground"}`}
        onClick={() => void handleFeedback("not_helpful")}
        disabled={pending}
        title="Not helpful"
        aria-label="Mark as not helpful"
      >
        <IconForThumbsDown />
      </Button>
    </div>
  );
}
