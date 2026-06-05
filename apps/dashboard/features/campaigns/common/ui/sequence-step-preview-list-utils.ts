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
