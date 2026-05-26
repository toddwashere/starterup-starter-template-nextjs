/** Prevents password-manager extensions from injecting DOM before React hydrates. */
export const passwordManagerSafeFormProps = {
  "data-lpignore": "true",
  "data-1p-ignore": "",
  "data-bwignore": "",
} as const;
