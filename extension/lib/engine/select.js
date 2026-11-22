// Candidate cleanup and selection.
//
// The model returns several candidates. Each one is cleaned (formatting only,
// never rewording), scored against the things that make text read as
// machine-written or repetitive, and the best ones are returned in order.

import {
  bannedHits,
  charLength,
  collapseDuplication,
  extractHandles,
  extractHashtags,
  hasScriptDrift,
  jaccard,
  looksLikeRefusal,
  openingKey,
  stripEmoji,
  tokenSet,
  truncateTo,
  wordCount,
  words,
} from "./text.js";

const ACCEPT_SCORE = 50;
const GENERIC_QUESTION_RE =
  /^(what do you think|thoughts|what are your thoughts|how do you feel|what's your take|what is your take|anyone else|agree|right)\b[^?]*\?$/i;
const URL_RE = /https?:\/\/[^\s<>"]+|\bwww\.[^\s<>"]+/gi;

// ctx: { kind, maxChars, emojiMax, source, multiline }
export function cleanCandidate(raw, ctx) {
  let s = String(raw ?? "").replace(/\r/g, "").replace(/\u2039/g, "<"); // undo the prompt's "<" stand-in
  const sourceLower = String(ctx.source || "").toLowerCase();
  const allowedHandles = extractHandles(ctx.source);
  const allowedTags = extractHashtags(ctx.source);

  s = s.replace(/^\s*(?:[-*•]\s+|\(?\d{1,2}[.)/]\s*(?:\d{1,2}\)?\s*)?)/, ""); // "- ", "1. ", "1/5 "
  s = s.replace(/^(?:reply|candidate|option|version|tweet|post)\s*\d*\s*:\s*/i, "");
  s = s.replace(/(\d)\s*[–—]\s*(\d)/g, "$1-$2"); // keep numeric ranges readable
  s = s.replace(/\s*[—–]\s*/g, ", ");
  s = s.replace(/[“”"«»]/g, "");
  if (/^['‘’`].*['‘’`]$/s.test(s)) s = s.slice(1, -1);

  s = s.replace(URL_RE, (u) => (sourceLower.includes(u.toLowerCase()) ? u : ""));
  s = s.replace(/@[A-Za-z0-9_]{1,15}/g, (h) => (allowedHandles.has(h.toLowerCase()) ? h : ""));
  s = s.replace(/#[\p{L}\p{N}_]+/gu, (t) => (allowedTags.has(t.toLowerCase()) ? t : ""));

  if (ctx.multiline) s = s.replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n");
  else s = s.replace(/\s*\n+\s*/g, " ");

  s = stripEmoji(s, ctx.emojiMax ?? 0);
  s = s
    .replace(/[ \t]{2,}/g, " ")
    .replace(/[ \t]+([.,!?;:])/g, "$1")
    .replace(/,(\s*,)+/g, ",")
    .replace(/^[\s,.;:!?]+/, "")
    .trim();
  s = collapseDuplication(s);
  s = truncateTo(s, ctx.maxChars);

  if (ctx.kind === "question" && s) {
    const q = s.indexOf("?");
    // Keep a single question: cut anything after the first question mark.
    s = q === -1 ? s.replace(/[.!,;:\s]+$/, "") + "?" : s.slice(0, q + 1);
  }
  return s;
}

// ctx adds: wordRange, recent, rejected, latinTarget, countWords
export function scoreCandidate(text, ctx) {
  const reasons = [];
  const fail = (reason) => ({ score: -Infinity, reasons: [reason] });

  if (!text) return fail("empty");
  if (looksLikeRefusal(text)) return fail("refusal");
  if (/<\/?[a-z]+[^>]*>|^\s*[{[]|"candidates"|"tweets"/i.test(text)) return fail("format_leak");
  if (ctx.latinTarget && hasScriptDrift(text)) return fail("script_drift");
  if (charLength(text) > ctx.maxChars) return fail("too_long");

  const wc = wordCount(text);
  const countWords = ctx.countWords !== false;
  if (countWords && wc < (ctx.kind === "question" ? 3 : 2)) return fail("too_short");

  let score = 100;
  const penalize = (points, reason) => {
    score -= points;
    reasons.push(reason);
  };

  const banned = bannedHits(text);
  if (banned.length) penalize(30 * banned.length, `banned:${banned.join("|")}`);

  const tokens = tokenSet(text);
  let similarity = 0;
  for (const prev of [...(ctx.recent || []), ...(ctx.rejected || [])]) similarity = Math.max(similarity, jaccard(tokens, prev));
  if (similarity >= 0.55) penalize(45, "repeats_recent");
  else if (similarity >= 0.4) penalize(20, "close_to_recent");

  const opening = openingKey(text);
  if (opening && (ctx.recent || []).slice(0, 6).some((r) => openingKey(r) === opening)) penalize(15, "repeated_opening");

  if (ctx.kind !== "rewrite" && countWords) {
    // Echo: a reply built mostly from the post's own words is a summary.
    const sourceTokens = tokenSet(ctx.source);
    const content = words(text.toLowerCase()).filter((w) => w.length >= 4);
    if (content.length >= 4) {
      const echoed = content.filter((w) => sourceTokens.has(w)).length / content.length;
      if (echoed > 0.7) penalize(25, "echoes_source");
    }
  }

  if (countWords && ctx.wordRange) {
    const [min, max] = ctx.wordRange;
    if (wc < min) penalize(Math.min(30, (min - wc) * 4), "short");
    if (wc > max) penalize(Math.min(40, (wc - max) * 3), "long");
  }

  if ((text.match(/!/g) || []).length > 1) penalize(8, "exclamations");
  if ((text.match(/\b[A-Z]{4,}\b/g) || []).length >= 2) penalize(8, "shouting");
  if (ctx.kind === "question" && GENERIC_QUESTION_RE.test(text.trim())) penalize(60, "generic_question");

  return { score, reasons };
}

// Returns { variants: string[], rejected: [{ text, reasons }] }.
// variants is empty only when every candidate failed a hard check.
export function selectCandidates(rawList, ctx, want = 3) {
  const scored = [];
  const rejected = [];
  for (const raw of Array.isArray(rawList) ? rawList : []) {
    if (typeof raw !== "string") continue;
    const text = cleanCandidate(raw, ctx);
    const { score, reasons } = scoreCandidate(text, ctx);
    if (score === -Infinity) {
      rejected.push({ text: text.slice(0, 80), reasons });
      continue;
    }
    // Drop near-identical siblings so "regenerate" always shows something new.
    if (scored.some((s) => jaccard(s.text, text) >= 0.8)) continue;
    scored.push({ text, score, reasons });
  }
  scored.sort((a, b) => b.score - a.score);
  const accepted = scored.filter((s) => s.score >= ACCEPT_SCORE);
  // Nothing clean: return the least bad one rather than nothing.
  const chosen = accepted.length ? accepted : scored.slice(0, 1);
  for (const s of scored) if (!chosen.includes(s)) rejected.push({ text: s.text.slice(0, 80), reasons: s.reasons });
  return { variants: chosen.slice(0, want).map((s) => s.text), rejected };
}

// Threads are one ordered piece of writing, so tweets are cleaned but not
// ranked. Returns [] when the thread is unusable.
export function cleanThread(rawTweets, ctx) {
  if (!Array.isArray(rawTweets)) return [];
  const tweets = [];
  for (const raw of rawTweets) {
    if (typeof raw !== "string") continue;
    const text = cleanCandidate(raw, { ...ctx, multiline: true });
    if (!text) continue;
    if (looksLikeRefusal(text)) return [];
    if (ctx.latinTarget && hasScriptDrift(text)) return [];
    tweets.push(text);
  }
  return tweets.length >= 2 ? tweets.slice(0, 12) : [];
}
