"use client";

import { useState, useTransition } from "react";
import { Button } from "@workspace/ui/components/button";
import {
  unsubscribeAllMarketingAction,
  unsubscribeFromSequenceMarketingAction,
} from "@/app/email/preferences/actions";

type PreferenceContext = {
  organizationName: string;
  sequenceName: string | null;
  showSequenceUnsubscribe: boolean;
};

export function PreferencePageContent({
  token,
  context,
}: {
  token: string;
  context: PreferenceContext;
}) {
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUnsubscribeAll() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await unsubscribeAllMarketingAction(token);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setMessage("You have been unsubscribed from all marketing email.");
    });
  }

  function handleUnsubscribeSequence() {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await unsubscribeFromSequenceMarketingAction(token);
      if (!result.success) {
        setError(result.error);
        return;
      }
      setMessage(
        context.sequenceName
          ? `You have been unsubscribed from ${context.sequenceName}.`
          : "You have been unsubscribed from this sequence.",
      );
    });
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-lg flex-col justify-center px-6 py-16">
      <div className="space-y-6 rounded-lg border bg-card p-8 shadow-sm">
        <div className="space-y-2">
          <h1 className="text-2xl font-semibold tracking-tight">Email preferences</h1>
          <p className="text-sm text-muted-foreground">
            Manage marketing email from {context.organizationName}.
          </p>
        </div>

        <div className="space-y-3">
          <Button
            variant="destructive"
            className="w-full"
            disabled={isPending}
            onClick={() => void handleUnsubscribeAll()}
          >
            Unsubscribe from all marketing email
          </Button>

          {context.showSequenceUnsubscribe && context.sequenceName && (
            <Button
              variant="outline"
              className="w-full"
              disabled={isPending}
              onClick={() => void handleUnsubscribeSequence()}
            >
              Unsubscribe from {context.sequenceName}
            </Button>
          )}
        </div>

        {message && <p className="text-sm text-green-700 dark:text-green-400">{message}</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </div>
    </main>
  );
}
