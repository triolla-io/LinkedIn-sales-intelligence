import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    "a", "b", "br", "div", "em", "font", "i", "img", "p", "span", "strong",
    "table", "tbody", "td", "tfoot", "th", "thead", "tr", "u", "ul", "ol", "li", "hr",
  ],
  allowedAttributes: {
    a: ["href", "target", "rel", "style"],
    img: ["src", "alt", "width", "height", "style"],
    font: ["color", "face", "size", "style"],
    "*": ["style", "align", "dir"],
  },
  allowedSchemes: ["http", "https", "mailto", "tel", "cid", "data"],
  allowProtocolRelative: true,
  // sanitize-html drops on* handlers and disallowed schemes (incl. javascript:) by default.
};

export function sanitizeSignature(html: string): string {
  if (typeof html !== "string") return "";
  try {
    return sanitizeHtml(html, OPTIONS);
  } catch {
    return "";
  }
}
