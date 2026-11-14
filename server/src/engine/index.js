// The generation engine: prompt -> model -> parse -> clean and rank -> moderate.

import { buildPrompt, LATIN_LANGUAGES, UNSPACED_LANGUAGES } from "./prompts.js";
import { cleanThread, selectCandidates } from "./select.js";
import { isMostlyNonLatin, looksLikeRefusal, nonLatinCount } from "./text.js";
import { UpstreamError } from "./openai.js";

export class EngineError extends Error {
  constructor(code, message, usage = { tokensIn: 0, tokensOut: 0 }) {
    super(message);
    this.name = "EngineError";
    this.code = code; // no_usable_output | content_blocked | upstream_auth | upstream_busy | upstream_timeout | upstream_error
    this.usage = usage;
  }
}

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

function mapUpstream(err, usage) {
  if (!(err instanceof UpstreamError)) return err;
  switch (err.kind) {
    case "auth":
    case "model":
    case "bad_request":
      return new EngineError("upstream_auth", err.message, usage);
    case "rate_limited":
      return new EngineError("upstream_busy", err.message, usage);
    case "timeout":
      return new EngineError("upstream_timeout", err.message, usage);
    default:
      return new EngineError("upstream_error", err.message, usage);
  }
}

export function createEngine(config, { openai, logger, rng = Math.random }) {
  return {
    model: openai.model,

    // input: validated /v1/generate body.
    // -> { variants: string[] } or { thread: string[] }, plus tokensIn/tokensOut/attempts.
    async generate(input, { safetyId } = {}) {
      const usage = { tokensIn: 0, tokensOut: 0 };
      const deadline = Date.now() + config.openai.totalTimeoutMs;
      let attempts = 0;

      for (const strict of [false, true]) {
        attempts++;
        const plan = buildPrompt(input, { rng, strict });
        let res;
        try {
          res = await openai.chat({
            messages: plan.messages,
            schemaName: plan.schemaName,
            schema: plan.schema,
            maxTokens: plan.spec.maxTokens,
            temperature: plan.spec.temperature,
            safetyId,
            deadline,
          });
        } catch (err) {
          throw mapUpstream(err, usage);
        }
        usage.tokensIn += res.tokensIn;
        usage.tokensOut += res.tokensOut;

        if (res.refusal || looksLikeRefusal(res.content)) {
          throw new EngineError("content_blocked", "The model declined to write this.", usage);
        }

        // A rewrite keeps the language of its draft whatever the reply
        // language setting says, so its script checks follow the draft.
        const language = input.kind === "rewrite" ? "auto" : plan.language;
        const sourceNonLatin = nonLatinCount(plan.source) > 0;
        const ctx = {
          kind: input.kind,
          maxChars: plan.spec.maxChars,
          emojiMax: plan.emojiMax,
          source: plan.source,
          wordRange: plan.wordRange,
          recent: input.recent || [],
          rejected: input.rejected || [],
          multiline: input.kind === "post" || input.kind === "rewrite",
          latinTarget: language === "auto" ? !sourceNonLatin : LATIN_LANGUAGES.has(language),
          countWords: language === "auto" ? !isMostlyNonLatin(plan.source) : !UNSPACED_LANGUAGES.has(language),
        };
        const list = parseList(res.content, plan.field);

        let result;
        if (input.kind === "thread") {
          const thread = cleanThread(list, ctx);
          result = thread.length ? { thread } : null;
        } else {
          const { variants, rejected } = selectCandidates(list, ctx, plan.spec.candidates);
          if (rejected.length) logger?.debug({ kind: input.kind, rejected }, "candidates rejected");
          result = variants.length ? { variants } : null;
        }
        if (!result) continue; // one stricter retry

        // Moderate what would be shown. Flagged variants are dropped; if
        // nothing survives, the request is refused.
        const texts = result.thread ? [result.thread.join("\n\n")] : result.variants;
        const flagged = await openai.moderate(texts);
        if (result.thread) {
          if (flagged[0]) throw new EngineError("content_blocked", "The generated thread was blocked by the safety check.", usage);
        } else {
          result.variants = result.variants.filter((_, i) => !flagged[i]);
          if (!result.variants.length) {
            throw new EngineError("content_blocked", "The generated text was blocked by the safety check.", usage);
          }
        }
        return { ...result, ...usage, attempts };
      }

      throw new EngineError("no_usable_output", "The model did not return usable text. Try again.", usage);
    },
  };
}
