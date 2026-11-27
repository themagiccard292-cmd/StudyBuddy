// Safe renderer for tutor text: paragraphs, **bold**, *italic*, `code`, lists and LaTeX math ($x^2$ or $$..$$).
// No raw HTML is ever rendered except KaTeX's own output.
import katex from "/vendor/katex/katex.mjs";
import { h } from "./dom.js";

const INLINE = /(\$\$[^$]+\$\$|\$(?! )[^$\n]*[^$\s]\$|\*\*[^*]+\*\*|\*[^*\s][^*\n]*\*|`[^`]+`)/g;

function math(src, display) {
  try {
    const span = document.createElement("span");
    if (display) span.className = "math-display";
    span.innerHTML = katex.renderToString(src, { displayMode: display, throwOnError: false, trust: false, output: "html" });
    return span;
  } catch {
    return null;
  }
}

export function inline(text) {
  return String(text)
    .split(INLINE)
    .map((part) => {
      if (!part) return null;
      if (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) return math(part.slice(2, -2), true) ?? part;
      if (part.startsWith("$") && part.endsWith("$") && part.length > 2) return math(part.slice(1, -1), false) ?? part;
      if (part.startsWith("**") && part.endsWith("**") && part.length > 4) return h("strong", null, part.slice(2, -2));
      if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return h("em", null, part.slice(1, -1));
      if (part.startsWith("`") && part.endsWith("`") && part.length > 2) return h("code", { class: "code" }, part.slice(1, -1));
      return part;
    });
}

/** Inline-only span (for choices, list items). */
export const richInline = (text, cls = "") => h("span", { class: cls }, inline(text));

/** Block-level rich text. */
export function rich(text, cls = "") {
  const blocks = String(text).trim().split(/\n{2,}/);
  return h(
    "div",
    { class: `rich ${cls}` },
    blocks.map((block) => {
      const lines = block.split("\n");
      const bullets = lines.every((l) => /^\s*[-*•]\s+/.test(l));
      const numbers = lines.every((l) => /^\s*\d+[.)]\s+/.test(l));
      if (bullets || numbers) {
        return h(numbers ? "ol" : "ul", { class: "rich-list" }, lines.map((l) => h("li", null, inline(l.replace(/^\s*(?:[-*•]|\d+[.)])\s+/, "")))));
      }
      return h("p", null, lines.flatMap((l, i) => (i ? [h("br"), ...inline(l)] : inline(l))));
    })
  );
}
