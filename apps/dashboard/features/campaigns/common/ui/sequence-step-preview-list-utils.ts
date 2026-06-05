export function createInertEmailPreviewHtml(bodyHtml: string) {
  const inertBody = bodyHtml
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\s+href=(["']).*?\1/gi, ' href="#" tabindex="-1"')
    .replace(/<a\b(?![^>]*\btabindex=)/gi, '<a tabindex="-1"');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <style>
      html,
      body {
        margin: 0;
        overflow: hidden;
        pointer-events: none;
        background: white;
      }

      * {
        box-sizing: border-box;
        pointer-events: none !important;
      }

      a {
        cursor: default;
      }
    </style>
  </head>
  <body>${inertBody}</body>
</html>`;
}

export function sortStepsByDelay<T extends { delayMinutes: number }>(steps: T[]) {
  return steps
    .map((step, originalIndex) => ({ step, originalIndex }))
    .sort((a, b) => {
      const delayDiff = a.step.delayMinutes - b.step.delayMinutes;
      return delayDiff === 0 ? a.originalIndex - b.originalIndex : delayDiff;
    })
    .map(({ step }) => step);
}
