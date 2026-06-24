export const EMAIL_TYPOGRAPHY =
  "font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:1.5; font-weight:400; color:#222222; -webkit-text-size-adjust:100%; text-size-adjust:100%";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Convert plain text into Gmail-style block HTML: each line is a <div>, blank lines become <div><br></div>. */
export function textToEmailHtml(body: string): string {
  const lines = body.split("\n");
  return lines
    .map((line) => (line.length === 0 ? "<div><br></div>" : `<div>${escapeHtml(line)}</div>`))
    .join("");
}

/** Full email HTML: a complete document with a viewport meta tag (so mobile clients don't shrink the text), typography wrapper + body, with the signature (already sanitized HTML) appended after two blank lines. */
export function composeEmailHtml(body: string, signatureHtml?: string | null): string {
  const bodyHtml = textToEmailHtml(body);
  const sig =
    signatureHtml && signatureHtml.trim().length > 0
      ? `<div><br></div><div><br></div>${signatureHtml}`
      : "";
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head><body style="margin:0; padding:0;"><div dir="auto" style="${EMAIL_TYPOGRAPHY}">${bodyHtml}${sig}</div></body></html>`;
}
