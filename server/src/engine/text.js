// Text utilities for the generation engine. Pure functions, no I/O.
// Several of these are ports of the v2 in-browser engine, tightened up.
//
// Also copied into the Unlimited edition of the extension (see parse.js).

export const EMOJI_RE = /(?:\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E)?)*)/gu;

export function countEmoji(text) {
  return (String(text || "").match(EMOJI_RE) || []).length;
}

export function hasEmoji(text) {
  return countEmoji(text) > 0;
}

export function stripEmoji(text, keep = 0) {
  let kept = 0;
  return String(text || "")
    .replace(EMOJI_RE, (m) => (kept++ < keep ? m : ""))
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?])/g, "$1")
    .trim();
}

export function words(text) {
  return String(text || "").match(/[\p{L}\p{N}][\p{L}\p{N}’'-]*/gu) || [];
}

export function wordCount(text) {
  return words(text).length;
}

export function tokenSet(text) {
  return new Set(words(String(text || "").toLowerCase()));
}

export function jaccard(a, b) {
  const A = a instanceof Set ? a : tokenSet(a);
  const B = b instanceof Set ? b : tokenSet(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter++;
  return inter / (A.size + B.size - inter);
}

// The first one or two words, normalized. Used to stop every reply opening
// the same way ("I think...", "This is...").
export function openingKey(text) {
  const w = words(String(text || "").toLowerCase().replace(/[’]/g, "'"));
  if (!w.length) return "";
  const first = w[0];
  if (["i", "i'm", "i'd", "i've", "this", "that", "the", "not", "so"].includes(first) && w[1]) return `${first} ${w[1]}`;
  return first;
}

// Collapses text that was emitted twice ("abc abc") or with a sentence
// repeated back to back. Iterates to a fixed point.
export function collapseDuplication(text) {
  let s = String(text || "").replace(/[ \t]+/g, " ").trim();
  const norm = (x) => x.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
  const pass = (input) => {
    for (let i = Math.floor(input.length / 2); i >= 8; i--) {
      const a = input.slice(0, i).trim();
      const b = input.slice(i).trim();
      if (a && b && a.toLowerCase() === b.toLowerCase()) return a;
    }
    const parts = input.match(/[^.!?\n]+[.!?]*[ \t]*|\n+/g) || [input];
    const out = [];
    let last = "";
    for (const part of parts) {
      if (/^\n+$/.test(part)) {
        out.push(part); // keep line breaks as written
        continue;
      }
      const n = norm(part);
      if (n && n === last) continue;
      if (n) last = n;
      out.push(part);
    }
    return out.join("").replace(/[ \t]+/g, " ").replace(/ ?\n ?/g, "\n").trim();
  };
  for (let i = 0; i < 8; i++) {
    const next = pass(s);
    if (next === s) break;
    s = next;
  }
  return s;
}

const NON_LATIN_RE =
  /[\u0250-\u02AF\u0370-\u03FF\u0400-\u052F\u0590-\u05FF\u0600-\u06FF\u0700-\u074F\u0900-\u097F\u0980-\u09FF\u0A00-\u0AFF\u0B00-\u0BFF\u0C00-\u0C7F\u0E00-\u0E7F\u1100-\u11FF\u3040-\u309F\u30A0-\u30FF\u3100-\u312F\u3400-\u4DBF\u4E00-\u9FFF\uAC00-\uD7AF]/g;

export function nonLatinCount(text) {
  return (String(text || "").replace(EMOJI_RE, "").match(NON_LATIN_RE) || []).length;
}

// True when most letters are outside the Latin script.
export function isMostlyNonLatin(text) {
  const letters = (String(text || "").match(/\p{L}/gu) || []).length;
  return letters > 0 && nonLatinCount(text) / letters > 0.4;
}

// Output that has drifted into another script or into mojibake while the
// target language is Latin-script. One stray character is tolerated.
export function hasScriptDrift(text) {
  const s = String(text || "");
  if (nonLatinCount(s) > 1) return true;
  if (/[\uFFFD\uE000-\uF8FF]/.test(s)) return true;
  return false;
}

// Cut to a character budget at a sentence end when possible, otherwise at a
// word boundary. Counts code points so emoji are not split.
export function truncateTo(text, maxChars) {
  const chars = Array.from(String(text || ""));
  if (chars.length <= maxChars) return chars.join("");
  const cut = chars.slice(0, maxChars).join("");
  const sentenceEnd = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "));
  if (sentenceEnd > maxChars * 0.5) return cut.slice(0, sentenceEnd + 1).trim();
  const space = cut.lastIndexOf(" ");
  return (space > maxChars * 0.5 ? cut.slice(0, space) : cut).replace(/[\s,;:]+$/, "").trim();
}

export function charLength(text) {
  return Array.from(String(text || "")).length;
}

export function extractHandles(text) {
  return new Set((String(text || "").toLowerCase().match(/@[a-z0-9_]{1,15}/g) || []));
}

export function extractHashtags(text) {
  return new Set((String(text || "").toLowerCase().match(/#[\p{L}\p{N}_]+/gu) || []));
}

// Phrases that mark text as machine-written or as empty engagement bait.
// A candidate containing one loses to any candidate that does not.
export const BANNED_PHRASES = [
  "curious",
  "sounds like",
  "seems like",
  "looks like",
  "feels like",
  "as an ai",
  "overall",
  "in conclusion",
  "one thing to note",
  "worth noting",
  "this highlights",
  "it's important",
  "it is important",
  "from my perspective",
  "i would suggest",
  "i recommend",
  "well said",
  "insightful",
  "intriguing",
  "great point",
  "powerful",
  "valuable insight",
  "couldn't agree more",
  "this is huge",
  "game changer",
  "game-changer",
  "big if true",
  "love to see",
  "love this",
  "thanks for sharing",
  "very informative",
  "nicely explained",
  "absolutely",
  "definitely worth",
  "super interesting",
  "exciting times",
  "massive update",
  "huge opportunity",
  "strong fundamentals",
  "promising project",
  "the future is bright",
  "keep building",
  "great thread",
  "excited",
  "interesting to see",
  "will be interesting",
  "watching this closely",
  "worth watching",
  "keen to see",
  "looking forward",
  "can't wait",
  "strong update",
  "huge update",
  "big move",
  "delve",
  "testament to",
  "in today's",
  "let's dive",
  "food for thought",
];

const BANNED_RES = BANNED_PHRASES.map(
  (p) => new RegExp(`(?<![\\p{L}\\p{N}])${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]")}(?![\\p{L}\\p{N}])`, "iu"),
);

export function bannedHits(text) {
  const s = String(text || "");
  const hits = [];
  BANNED_RES.forEach((re, i) => {
    if (re.test(s)) hits.push(BANNED_PHRASES[i]);
  });
  return hits;
}

const REFUSAL_RE =
  /^(i['’]?m sorry|i am sorry|sorry,? (but )?i|i can(['’]?t|not) (help|assist|write|comply|create|generate)|i['’]?m (unable|not able) to|as an ai\b|i cannot\b)/i;

export function looksLikeRefusal(text) {
  return REFUSAL_RE.test(String(text || "").trim());
}
