// Reading the model's answer. Pure, no I/O.
//
// This file, select.js and text.js are also copied into the Unlimited
// edition of the extension (see scripts/pack-extension.mjs), where drafts
// written on the user's own computer get the same cleanup and ranking as
// drafts written here. Keep them free of Node-only APIs.

// Pull the string array out of whatever the model returned: strict JSON, JSON
// wrapped in prose or a code fence, truncated JSON, or plain lines.
export function parseList(content, field) {
  const text = String(content || "").trim();
  if (!text) return [];
  const tryParse = (s) => {
    try {
      const obj = JSON.parse(s);
      const list = Array.isArray(obj) ? obj : obj?.[field];
      return Array.isArray(list) ? list.filter((x) => typeof x === "string") : null;
    } catch {
      return null;
    }
  };
  const direct = tryParse(text);
  if (direct) return direct;
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start !== -1 && end > start) {
    const inner = tryParse(text.slice(start, end + 1));
    if (inner) return inner;
  }
  // Truncated JSON: salvage every complete string literal after the field name.
  if (start !== -1) {
    const strings = [...text.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => {
      try {
        return JSON.parse(`"${m[1]}"`);
      } catch {
        return null;
      }
    });
    const salvaged = strings.filter((s) => typeof s === "string" && s !== field && s.length > 1);
    if (salvaged.length) return salvaged;
    return [];
  }
  return text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}
