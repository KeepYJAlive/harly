function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function createLtiFormPostHtml(input: {
  target: string;
  idToken: string;
  state: string;
}): string {
  const target = escapeHtml(input.target);
  const origin = escapeHtml(new URL(input.target).origin);
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; form-action ${origin}; script-src 'unsafe-inline'; style-src 'unsafe-inline'">
<title>Opening assessment</title></head>
<body><p>Opening your assessment…</p>
<form id="lti-launch" method="post" action="${target}">
<input type="hidden" name="id_token" value="${escapeHtml(input.idToken)}">
<input type="hidden" name="state" value="${escapeHtml(input.state)}">
<noscript><button type="submit">Continue to assessment</button></noscript>
</form><script>document.getElementById("lti-launch").submit()</script></body></html>`;
}
