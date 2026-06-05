"use client";

import { EmailEditor, type EmailEditorRef } from "@react-email/editor";
import { useCallback, useRef } from "react";

const DEFAULT_EDITOR_HTML = `
  <p>We wanted to reach out.</p>
  <p><a href="https://example.com">Learn more</a></p>
`;

export type CampaignEmailEditorValue = {
  editorDocument: unknown;
  composedBodyHtml: string;
  composedBodyText: string;
};

export function CampaignEmailEditor({
  content,
  onChange,
  disabled,
}: {
  content?: unknown;
  onChange: (value: CampaignEmailEditorValue) => void;
  disabled?: boolean;
}) {
  const ref = useRef<EmailEditorRef>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const exportContent = useCallback(
    async (editorRef: EmailEditorRef) => {
      const [json, email] = await Promise.all([
        Promise.resolve(editorRef.getJSON()),
        editorRef.getEmail(),
      ]);
      onChange({
        editorDocument: json,
        composedBodyHtml: email.html,
        composedBodyText: email.text,
      });
    },
    [onChange],
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

  const initialContent =
    content ??
    DEFAULT_EDITOR_HTML;

  return (
    <div className="min-h-[360px] overflow-hidden rounded-md border bg-background">
      <EmailEditor
        ref={ref}
        content={initialContent as string}
        editable={!disabled}
        onReady={(editorRef) => {
          void exportContent(editorRef);
        }}
        onUpdate={(editorRef) => {
          scheduleExport(editorRef);
        }}
      />
    </div>
  );
}
