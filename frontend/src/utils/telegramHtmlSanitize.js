// frontend/src/utils/telegramHtmlSanitize.js

/**
 * Telegram HTML supports (most useful):
 * <b>, <strong>, <i>, <em>, <u>, <ins>, <s>, <strike>, <del>, <a href="...">, <code>, <pre>, <br>
 * Everything else should be removed.
 *
 * This sanitizer is frontend-side and uses DOMParser.
 */

const ALLOWED_TAGS = new Set([
  "B",
  "STRONG",
  "I",
  "EM",
  "U",
  "INS",
  "S",
  "STRIKE",
  "DEL",
  "A",
  "CODE",
  "PRE",
  "BR",
]);

function escapeText(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function safeHref(href) {
  const s = String(href || "").trim();
  if (!s) return "";
  // allow only http(s) and tg deep links
  if (/^(https?:\/\/)/i.test(s)) return s;
  if (/^(tg:\/\/)/i.test(s)) return s;
  if (/^(mailto:)/i.test(s)) return s;
  return "";
}

function nodeToTelegramHtml(node) {
  if (!node) return "";

  // Text node
  if (node.nodeType === Node.TEXT_NODE) {
    return escapeText(node.nodeValue);
  }

  // Element node
  if (node.nodeType === Node.ELEMENT_NODE) {
    const tag = node.tagName;

    // Convert common block tags to line breaks around content
    const isBlock =
      tag === "P" ||
      tag === "DIV" ||
      tag === "SECTION" ||
      tag === "ARTICLE" ||
      tag === "HEADER" ||
      tag === "FOOTER";

    if (!ALLOWED_TAGS.has(tag)) {
      // Keep children content, but drop the tag itself
      let inner = "";
      node.childNodes.forEach((ch) => (inner += nodeToTelegramHtml(ch)));

      if (isBlock) {
        // add line breaks around blocks
        inner = inner.trim();
        if (!inner) return "";
        return `${inner}<br>`;
      }

      // For list-like tags, join with <br>
      if (tag === "LI") {
        inner = inner.trim();
        return inner ? `${inner}<br>` : "";
      }

      return inner;
    }

    // Allowed tags
    if (tag === "BR") return "<br>";

    // Special handling for <a>
    if (tag === "A") {
      const href = safeHref(node.getAttribute("href"));
      let inner = "";
      node.childNodes.forEach((ch) => (inner += nodeToTelegramHtml(ch)));
      inner = inner.trim() || escapeText(href);

      if (!href) {
        // if href is unsafe, render as plain text
        return inner;
      }
      return `<a href="${escapeText(href)}">${inner}</a>`;
    }

    // Normal allowed tags: wrap children
    let inner = "";
    node.childNodes.forEach((ch) => (inner += nodeToTelegramHtml(ch)));

    const open = tag.toLowerCase();
    const close = `</${open}>`;

    // Telegram is picky with <pre>: it should contain <code> or raw text; we keep as-is.
    return `<${open}>${inner}</${open}>`;
  }

  return "";
}

/**
 * Main sanitizer
 */
export function sanitizeTelegramHtml(inputHtml) {
  const html = String(inputHtml || "").trim();
  if (!html) return "";

  // DOMParser exists in browsers
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  let out = "";
  doc.body.childNodes.forEach((n) => {
    out += nodeToTelegramHtml(n);
  });

  // Normalize excessive <br>
  out = out
    .replace(/(<br>\s*){3,}/g, "<br><br>")
    .replace(/^\s*<br>/, "")
    .trim();

  return out;
}
