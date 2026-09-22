/**
 * The tiny self-contained HTML page the tokenized confirm / unsubscribe
 * routes return (issue #331). No session, no app shell, no client JS —
 * a neighbor who clicked a link in an email should see one sentence and
 * be done. Styled inline to match Hearth's dark surface.
 */

import { escapeHtml } from "./email";

export function renderTokenPage(input: {
  title: string;
  body: string;
  status?: number;
}): Response {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(input.title)} · Hearth</title>
<style>
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b0f19; color: #e6e1d8; font: 16px/1.5 -apple-system, "Segoe UI", Helvetica, Arial, sans-serif; padding: 24px; box-sizing: border-box; }
  main { max-width: 480px; }
  .eyebrow { font-size: 12px; letter-spacing: .08em; text-transform: uppercase; color: #8a857c; margin-bottom: 8px; }
  h1 { font-size: 24px; line-height: 1.25; font-weight: 500; margin: 0 0 12px; }
  p { margin: 0 0 12px; color: #c9c3b8; }
  .foot { margin-top: 28px; font-size: 12px; color: #8a857c; }
</style>
</head>
<body>
<main>
  <div class="eyebrow">Hearth water advisories</div>
  <h1>${escapeHtml(input.title)}</h1>
  <p>${escapeHtml(input.body)}</p>
  <div class="foot">Hearth · a ToddTech project</div>
</main>
</body>
</html>`;
  return new Response(html, {
    status: input.status ?? 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
