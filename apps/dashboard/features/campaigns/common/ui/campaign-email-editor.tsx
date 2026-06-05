"use client";

import { EmailEditor, type EmailEditorRef } from "@react-email/editor";
import { useCallback, useRef } from "react";

const DEFAULT_EDITOR_HTML = `
  <p>We wanted to reach out.</p>
  <p><a href="https://example.com">Learn more</a></p>
`;

const REACT_EMAIL_KEY_WARNING =
  'Each child in a list should have a unique "key" prop';

/** @react-email/editor's composeReactEmail render path omits keys on template nodes. */
async function withSuppressedReactEmailKeyWarning<T>(fn: () => Promise<T>): Promise<T> {
  const originalError = console.error;
  console.error = (...args: unknown[]) => {
    const message = typeof args[0] === "string" ? args[0] : String(args[0]);
    if (message.includes(REACT_EMAIL_KEY_WARNING)) return;
    originalError.apply(console, args as Parameters<typeof console.error>);
  };
  try {
    return await fn();
  } finally {
    console.error = originalError;
  }
}

export type CampaignEmailEditorValue = {
  editorDocument: unknown;
  composedBodyHtml: string;
  composedBodyText: string;
};

export function CampaignEmailEditor({
  content,
  snapshot,
  onChange,
  disabled,
}: {
  content?: unknown;
  /** Cached HTML/text from the server — skips getEmail() on mount when present. */
  snapshot?: Pick<CampaignEmailEditorValue, "composedBodyHtml" | "composedBodyText">;
  onChange: (value: CampaignEmailEditorValue) => void;
  disabled?: boolean;
}) {
  const ref = useRef<EmailEditorRef>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exportContent = useCallback(
    async (editorRef: EmailEditorRef) => {
      await withSuppressedReactEmailKeyWarning(async () => {
        const json = editorRef.getJSON();
        const email = await editorRef.getEmail();
        onChange({
          editorDocument: json,
          composedBodyHtml: email.html,
          composedBodyText: email.text,
        });
      });
    },
    [onChange],
  );

  const syncDocumentOnly = useCallback(
    (editorRef: EmailEditorRef) => {
      if (!snapshot?.composedBodyHtml) {
        void exportContent(editorRef);
        return;
      }
      onChange({
        editorDocument: editorRef.getJSON(),
        composedBodyHtml: snapshot.composedBodyHtml,
        composedBodyText: snapshot.composedBodyText ?? "",
      });
    },
    [exportContent, onChange, snapshot],
  );

  const scheduleExport = useCallback(
    (editorRef: EmailEditorRef) => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        void exportContent(editorRef);
      }, 400);
    },
    [exportContent],
  );

  const initialContent = content ?? DEFAULT_EDITOR_HTML;

  return (
    <div className="min-h-[360px] overflow-hidden rounded-md border bg-background">
      <EmailEditor
        ref={ref}
        content={initialContent as string}
        editable={!disabled}
        onReady={syncDocumentOnly}
        onUpdate={(editorRef) => {
          scheduleExport(editorRef);
        }}
      />
    </div>
  );
}
