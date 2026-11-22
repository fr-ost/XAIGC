// The cleanup and ranking every draft goes through (extension/lib/engine/).
//
//   node --test "test/*.test.mjs"

import { test } from "node:test";
import assert from "node:assert/strict";

import { bannedHits, collapseDuplication, hasScriptDrift, openingKey, stripEmoji, truncateTo } from "../extension/lib/engine/text.js";
import { cleanCandidate, cleanThread, scoreCandidate, selectCandidates } from "../extension/lib/engine/select.js";
import { parseList } from "../extension/lib/engine/parse.js";

test("collapseDuplication folds doubled output", () => {
  assert.equal(collapseDuplication("Fees matter more than speed here. Fees matter more than speed here."), "Fees matter more than speed here.");
  assert.equal(collapseDuplication("that is a fair point that is a fair point"), "that is a fair point");
  assert.equal(collapseDuplication("One thing. Another thing."), "One thing. Another thing.");
});

test("stripEmoji keeps only the allowed number", () => {
  assert.equal(stripEmoji("nice one 🚀🔥 really 😂"), "nice one really");
  assert.equal(stripEmoji("nice one 🚀🔥 really 😂", 1), "nice one 🚀 really");
});

test("truncateTo prefers a sentence end, never splits a word", () => {
  const long = "First sentence is here. Second sentence goes on for quite a while and never ends";
  assert.equal(truncateTo(long, 40), "First sentence is here.");
  assert.equal(truncateTo("abcdefghij klmnopqrst uvwxyz", 22), "abcdefghij klmnopqrst");
  assert.equal(truncateTo("short", 40), "short");
});

test("bannedHits respects word boundaries", () => {
  assert.deepEqual(bannedHits("Im curious how this plays out"), ["curious"]);
  assert.deepEqual(bannedHits("The overallocation is the issue"), [], "'overall' inside a longer word is fine");
  assert.deepEqual(bannedHits("can’t wait for this"), ["can't wait"], "curly apostrophes match");
  assert.deepEqual(bannedHits("fees still look high to me"), []);
});

test("hasScriptDrift flags mixed scripts and mojibake", () => {
  assert.equal(hasScriptDrift("Fees look fine to me"), false);
  assert.equal(hasScriptDrift("Fees look fine café €5"), false);
  assert.equal(hasScriptDrift("Fees look 手数料 fine"), true);
  assert.equal(hasScriptDrift("Fees look � fine"), true);
});

test("openingKey groups common starts", () => {
  assert.equal(openingKey("I think this is fine"), "i think");
  assert.equal(openingKey("I’d wait a week"), "i'd wait");
  assert.equal(openingKey("Honestly, no"), "honestly");
  assert.equal(openingKey("This part matters"), "this part");
});

const ctx = (over = {}) => ({
  kind: "reply",
  maxChars: 280,
  emojiMax: 0,
  source: "We just cut bridge fees by 80% for every user. Details: https://example.com/fees @partner #launch",
  wordRange: [8, 22],
  recent: [],
  rejected: [],
  latinTarget: true,
  ...over,
});

test("cleanCandidate: strips model formatting but not the wording", () => {
  assert.equal(cleanCandidate('1. "Fees matter — speed does not."', ctx()), "Fees matter, speed does not.");
  assert.equal(cleanCandidate("Reply: honestly not sure 🚀🚀", ctx()), "honestly not sure");
  assert.equal(cleanCandidate("Took 5–10 minutes for me", ctx()), "Took 5-10 minutes for me");
  assert.equal(cleanCandidate("line one\nline two", ctx()), "line one line two");
  assert.equal(cleanCandidate("line one\n\n\n\nline two", ctx({ multiline: true })), "line one\n\nline two");
});

test("cleanCandidate: links, handles and hashtags survive only if they were in the source", () => {
  const out = cleanCandidate("@partner said so https://example.com/fees and https://evil.example @random #launch #ad", ctx());
  assert.equal(out, "@partner said so https://example.com/fees and #launch");
});

test("cleanCandidate: questions end with exactly one question", () => {
  assert.equal(cleanCandidate("Does this cover withdrawals too", ctx({ kind: "question" })), "Does this cover withdrawals too?");
  assert.equal(cleanCandidate("Does this cover withdrawals? I hope so.", ctx({ kind: "question" })), "Does this cover withdrawals?");
});

test("cleanCandidate: enforces the character budget", () => {
  const out = cleanCandidate("word ".repeat(100), ctx());
  assert.ok(out.length <= 280);
});

test("scoreCandidate: hard failures", () => {
  assert.equal(scoreCandidate("", ctx()).score, -Infinity);
  assert.equal(scoreCandidate("I'm sorry, but I can't help with that.", ctx()).score, -Infinity);
  assert.equal(scoreCandidate('{"candidates": ["x"]}', ctx()).score, -Infinity);
  assert.equal(scoreCandidate("Fees look 手数料 fine to me honestly", ctx()).score, -Infinity);
  assert.notEqual(scoreCandidate("Fees look 手数料 fine to me honestly", ctx({ latinTarget: false })).score, -Infinity);
});

test("scoreCandidate: machine-sounding text loses to plain text", () => {
  const plain = scoreCandidate("Withdrawals were the expensive part for me, so that is where I'd look first.", ctx());
  const hype = scoreCandidate("This is huge, so excited to see where it goes, great point!", ctx());
  assert.ok(plain.score > hype.score);
  assert.ok(hype.score < 50, "hype falls below the acceptance bar");
  assert.ok(hype.reasons.some((r) => r.startsWith("banned")));
});

test("scoreCandidate: repetition of recent replies and openings is penalized", () => {
  const recent = ["Withdrawals were the expensive part for me, so that is where I'd look first."];
  const repeat = scoreCandidate("Withdrawals were the expensive part for me so that is where I'd look.", ctx({ recent }));
  assert.ok(repeat.reasons.includes("repeats_recent"));
  const opening = scoreCandidate("Withdrawals still cost more than the swap itself on most days.", ctx({ recent }));
  assert.ok(opening.reasons.includes("repeated_opening"));
  const echo = scoreCandidate("Bridge fees just cut for every user, details soon.", ctx());
  assert.ok(echo.reasons.includes("echoes_source"));
});

test("scoreCandidate: generic questions are rejected in practice", () => {
  const generic = scoreCandidate("What do you think?", ctx({ kind: "question", wordRange: [5, 12] }));
  const real = scoreCandidate("Does the cut apply to withdrawals too?", ctx({ kind: "question", wordRange: [5, 12] }));
  assert.ok(generic.score < 50 && real.score >= 50);
});

test("selectCandidates: ranks, drops near-duplicates, never returns nothing usable", () => {
  const { variants } = selectCandidates(
    [
      "This is huge, so excited to see where this goes!",
      "Withdrawals were the expensive part for me, so that is where I'd look first.",
      "Withdrawals were the expensive part for me, so that is where I would look first.",
      "Monday feels early given how the last rollout went, hoping they tested it.",
    ],
    ctx(),
  );
  assert.equal(variants.length, 2, "hype dropped, near-duplicate dropped");
  assert.ok(!variants.some((v) => /excited/.test(v)));

  const onlyBad = selectCandidates(["This is huge, so excited to see where this goes!"], ctx());
  assert.equal(onlyBad.variants.length, 1, "the least bad candidate is still returned");

  const allHard = selectCandidates(["", "I'm sorry, but I can't help with that."], ctx());
  assert.equal(allHard.variants.length, 0);
});

test("cleanThread: cleans numbering, refuses refusals and stubs", () => {
  const thread = cleanThread(["1/ Hook goes here", "2/ Second point — detail", "(3/3) Close it out"], ctx({ kind: "thread", maxChars: 275 }));
  assert.deepEqual(thread, ["Hook goes here", "Second point, detail", "Close it out"]);
  assert.deepEqual(cleanThread(["only one"], ctx()), []);
  assert.deepEqual(cleanThread(["I'm sorry, but I can't help with that.", "x y z"], ctx()), []);
});

test("cleanCandidate turns the prompt's '<' stand-in back into '<'", () => {
  assert.equal(cleanCandidate("fees \u2039 1% is the whole pitch", ctx()), "fees < 1% is the whole pitch");
});

test("parseList: strict JSON, wrapped JSON, truncated JSON, plain lines", () => {
  assert.deepEqual(parseList('{"candidates":["a b","c d"]}', "candidates"), ["a b", "c d"]);
  assert.deepEqual(parseList('```json\n{"candidates":["a b"]}\n```', "candidates"), ["a b"]);
  assert.deepEqual(parseList('{"candidates":["first one","second \\"quoted\\" one","third is cut o', "candidates"), ["first one", 'second "quoted" one']);
  assert.deepEqual(parseList("line one\nline two", "candidates"), ["line one", "line two"]);
  assert.deepEqual(parseList("", "candidates"), []);
  assert.deepEqual(parseList('{"candidates":[1,2]}', "candidates"), []);
});
