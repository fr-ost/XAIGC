// The writing engine. Every draft XAICG writes comes from here.
//
// The language model runs on the user's own computer (the `LanguageModel`
// interface): drafts cost nothing, there is no limit, and the post, the
// prompt and the draft never leave the computer.
//
// This module runs in the service worker (background.js). It only uses the
// model once it is on the computer. The one-time download is started from an
// extension page (device-ui.js), because Chrome may want the click of a
// person to start it.
//
// Every answer is cleaned and ranked by engine/*.js before it is shown:
// dashes, invented hashtags and links, generic praise and repeats are removed
// or ranked last.

import { parseList } from "./engine/parse.js";
import { cleanThread, selectCandidates } from "./engine/select.js";
import { isMostlyNonLatin, looksLikeRefusal, nonLatinCount } from "./engine/text.js";
import { buildDevicePrompt, DEVICE_LANGUAGES, KINDS, SYSTEM, sourceOf } from "./device-prompts.js";

const api = () => globalThis.LanguageModel;
const PROMPT_TIMEOUT_MS = 90_000; // a computer without a fast graphics card is slow
const STATUS_TTL_MS = 30_000;
const LANGUAGE_HINT = "XAICG writes English, Spanish, German, French and Japanese.";
const KANA = /[぀-ヿ]/;

export class DeviceError extends Error {
  // code: language | unavailable | not_ready | no_usable_output | blocked | failed
  constructor(code, message, cause) {
    super(message);
    this.name = "DeviceError";
    this.code = code;
    this.cause = cause;
  }
}

// Which language to ask the model for, or null when it cannot write the one
// needed here. "match" means: whatever language the material is in.
export function deviceLanguage(setting, source) {
  if (setting && setting !== "auto") return DEVICE_LANGUAGES.includes(setting) ? setting : null;
  if (KANA.test(source)) return "ja";
  // Chinese, Korean, Russian, Arabic, Hindi and other scripts: the model
  // does not write those.
  if (isMostlyNonLatin(source)) return null;
  return "match";
}

// What the model is told to expect, so Chrome can check (and fetch) what it
// needs for those languages before a session starts.
export function sessionLanguages(lang) {
  const outputs = lang === "match" ? ["en", "es", "de", "fr"] : [lang];
  return {
    expectedInputs: [{ type: "text", languages: [...new Set(["en", ...outputs])] }],
    expectedOutputs: [{ type: "text", languages: outputs }],
  };
}

const cache = new Map(); // language -> { state, at }

// unsupported: this version of Chrome cannot run the model (too old).
// unavailable: this computer cannot run it (hardware, disk space, platform).
// downloadable / downloading: it can, once the model is on the computer.
// available: ready.
export async function availability(lang = "en", { fresh = false } = {}) {
  const LM = api();
  if (!LM || typeof LM.availability !== "function") return "unsupported";
  const hit = cache.get(lang);
  if (!fresh && hit && Date.now() - hit.at < STATUS_TTL_MS) return hit.state;
  let state;
  try {
    state = await LM.availability(sessionLanguages(lang));
  } catch {
    state = "unavailable";
  }
  if (!["unavailable", "downloadable", "downloading", "available"].includes(state)) state = "unavailable";
  cache.set(lang, { state, at: Date.now() });
  return state;
}

// Sampling. Newer Chrome takes a preset (`samplingMode`); older Chrome takes
// raw values, which extensions may still set and which a preset overrides.
async function sampling(kind) {
  const options = { samplingMode: kind === "rewrite" ? "balanced" : "creative" };
  try {
    const p = await api().params?.();
    if (p && Number.isFinite(p.defaultTopK) && Number.isFinite(p.defaultTemperature)) {
      options.topK = p.defaultTopK;
      const warmer = kind === "rewrite" ? p.defaultTemperature : p.defaultTemperature * 1.2;
      options.temperature = Number.isFinite(p.maxTemperature) ? Math.min(p.maxTemperature, warmer) : warmer;
    }
  } catch {
    /* no raw parameters in this Chrome: the preset (or the default) applies */
  }
  return options;
}

function timeoutSignal(signal) {
  const timer = AbortSignal.timeout(PROMPT_TIMEOUT_MS);
  return signal && AbortSignal.any ? AbortSignal.any([signal, timer]) : timer;
}

function describe(err) {
  const name = err?.name || "";
  if (name === "TimeoutError" || name === "AbortError") return new DeviceError("failed", "The on-device AI took too long. Try again.", err);
  if (name === "NotSupportedError") return new DeviceError("language", `The on-device AI can't write this one. ${LANGUAGE_HINT}`, err);
  if (name === "QuotaExceededError") return new DeviceError("failed", "This post is too long for the on-device AI.", err);
  if (name === "NotAllowedError") return new DeviceError("not_ready", "The on-device AI couldn't start. Open XAICG Settings and press Set up.", err);
  return new DeviceError("failed", `The on-device AI didn't answer${err?.message ? ` (${err.message})` : ""}. Try again.`, err);
}

async function ask(session, plan, signal) {
  try {
    return await session.prompt(plan.prompt, { responseConstraint: plan.schema, signal });
  } catch (err) {
    // The JSON shape could not be enforced (an older model, or it could not
    // keep to it): ask in words and read the answer leniently.
    if (err?.name === "NotSupportedError" || err?.name === "SyntaxError" || err instanceof TypeError) {
      return session.prompt(plan.prompt, { signal });
    }
    throw err;
  }
}

// input: { kind, post | idea | draft, options, recent, rejected }.
// Returns { variants } or { thread }.
export async function generate(input, { signal, rng = Math.random } = {}) {
  const LM = api();
  const spec = KINDS[input.kind];
  if (!spec) throw new DeviceError("failed", "Unknown kind of draft.");
  const source = sourceOf(input);
  const setting = input.kind === "rewrite" ? "auto" : input.options?.language || "en";
  const lang = deviceLanguage(setting, source);
  if (!lang) throw new DeviceError("language", `This post is in a language XAICG doesn't write. ${LANGUAGE_HINT}`);

  const state = await availability(lang);
  if (state === "unsupported") throw new DeviceError("unavailable", "This version of Chrome can't run XAICG's on-device AI. Update Chrome, then try again.");
  if (state === "unavailable") throw new DeviceError("unavailable", "XAICG's on-device AI can't run on this computer. Open XAICG Settings to see what it needs.");
  if (state !== "available") throw new DeviceError("not_ready", "XAICG's on-device AI isn't set up yet. Open XAICG Settings and press Set up.");

  const ctx = {
    kind: input.kind,
    maxChars: spec.maxChars,
    source,
    recent: input.recent || [],
    rejected: input.rejected || [],
    multiline: input.kind === "post" || input.kind === "rewrite",
    latinTarget: lang === "ja" ? false : lang === "match" ? nonLatinCount(source) === 0 : true,
    countWords: lang !== "ja" && !(lang === "match" && isMostlyNonLatin(source)),
  };
  const createOptions = { ...sessionLanguages(lang), ...(await sampling(input.kind)), initialPrompts: [{ role: "system", content: SYSTEM }] };

  for (const strict of [false, true]) {
    const plan = buildDevicePrompt(input, { lang, strict, rng });
    const live = timeoutSignal(signal);
    let session;
    let raw;
    try {
      session = await LM.create({ ...createOptions, signal: live });
      raw = await ask(session, plan, live);
    } catch (err) {
      throw describe(err);
    } finally {
      try {
        session?.destroy();
      } catch {
        /* already gone */
      }
    }

    if (looksLikeRefusal(raw)) throw new DeviceError("blocked", "The on-device AI declined to write this one.");
    const list = parseList(raw, plan.field);
    const full = { ...ctx, emojiMax: plan.emojiMax, wordRange: plan.wordRange };
    if (input.kind === "thread") {
      const thread = cleanThread(list, full);
      if (thread.length) return { thread };
    } else {
      const { variants } = selectCandidates(list, full, spec.candidates);
      if (variants.length) return { variants };
    }
    // Nothing usable: one stricter try.
  }
  throw new DeviceError("no_usable_output", "The on-device AI didn't write a usable draft for this one. Try again.");
}

export const onDevice = {
  languages: DEVICE_LANGUAGES,
  // `fresh` forgets every earlier answer, for example right after setup.
  async status({ fresh = false } = {}) {
    if (fresh) cache.clear();
    return { state: await availability("en", { fresh }) };
  },
  generate,
};
