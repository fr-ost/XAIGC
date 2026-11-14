// Minimal OpenAI client over fetch.
//
// OpenAI's model families accept different request parameters (reasoning
// models reject `temperature` unless reasoning is off, older ones use other
// effort levels, and so on) and the cheap tier is replaced often. Rather than
// hard-code one model's quirks, the client starts from a best guess for the
// configured model and, when the API answers 400 naming a parameter, adjusts
// that parameter and retries. Changing OPENAI_MODEL should never need a code
// change.

export class UpstreamError extends Error {
  constructor(kind, message, status = 0) {
    super(message);
    this.name = "UpstreamError";
    this.kind = kind; // auth | model | rate_limited | bad_request | unavailable | timeout
    this.status = status;
  }
}

export function initialProfile(model, effortOverride = "") {
  const m = String(model).toLowerCase();
  let effort = null;
  let temperature = true;
  if (/^o\d/.test(m)) {
    effort = "low";
    temperature = false;
  } else if (/^gpt-5(-mini|-nano)?(-\d{4}-\d{2}-\d{2})?$/.test(m)) {
    effort = "minimal";
    temperature = false;
  } else if (/^gpt-(5\.\d|[6-9])/.test(m) && !m.includes("chat")) {
    // Newer reasoning families: reasoning off keeps replies fast and cheap
    // and keeps `temperature` available.
    effort = "none";
    temperature = true;
  }
  if (effortOverride) {
    effort = effortOverride;
    temperature = effortOverride === "none";
  }
  return { effort, temperature, safetyId: true, structured: "json_schema", tokensParam: "max_completion_tokens" };
}

const ADAPTABLE = ["temperature", "reasoning_effort", "safety_identifier", "max_completion_tokens", "response_format"];

// Mutates `profile` in response to a 400. Returns true when something changed
// and the request is worth retrying.
export function adaptProfile(profile, error) {
  const param = String(error?.param || "").toLowerCase();
  const message = String(error?.message || "").toLowerCase();
  const target = ADAPTABLE.find((p) => param.startsWith(p)) || ADAPTABLE.find((p) => message.includes(p)) ||
    (message.includes("json_schema") ? "response_format" : null);

  switch (target) {
    case "temperature":
      if (!profile.temperature) return false;
      profile.temperature = false;
      return true;
    case "reasoning_effort":
      if (profile.effort === "none" || profile.effort === "minimal") {
        profile.effort = "low";
        profile.temperature = false;
        return true;
      }
      if (profile.effort) {
        profile.effort = null;
        return true;
      }
      return false;
    case "safety_identifier":
      if (!profile.safetyId) return false;
      profile.safetyId = false;
      return true;
    case "max_completion_tokens":
      if (profile.tokensParam !== "max_completion_tokens") return false;
      profile.tokensParam = "max_tokens";
      return true;
    case "response_format":
      if (profile.structured === "json_schema") profile.structured = "json_object";
      else if (profile.structured === "json_object") profile.structured = "none";
      else return false;
      return true;
    default:
      return false;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function createOpenAI(config, { fetchImpl = globalThis.fetch, logger } = {}) {
  const { apiKey, baseUrl, model, timeoutMs } = config.openai;
  const profile = initialProfile(model, config.openai.reasoningEffort);

  async function call(method, path, body, { attempts = 2, timeout = timeoutMs, deadline = Infinity } = {}) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      // Never start a call that cannot finish inside the overall budget.
      const remaining = deadline - Date.now();
      if (remaining < 500) throw lastError || new UpstreamError("timeout", "OpenAI request timed out.");
      const budget = Math.min(timeout, remaining);
      let res;
      try {
        res = await fetchImpl(`${baseUrl}${path}`, {
          method,
          headers: {
            Authorization: `Bearer ${apiKey}`,
            ...(body ? { "Content-Type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
          signal: AbortSignal.timeout(budget),
        });
      } catch (err) {
        const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
        lastError = new UpstreamError(timedOut ? "timeout" : "unavailable", timedOut ? "OpenAI request timed out." : `OpenAI unreachable: ${err?.message || err}`);
        if (attempt < attempts) await sleep(400 * attempt);
        continue;
      }

      const text = await res.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        /* non-JSON body (proxy error page) */
      }
      if (res.ok && json) return json;

      const detail = json?.error?.message || text.slice(0, 200) || `HTTP ${res.status}`;
      if (res.status === 401 || res.status === 403) throw new UpstreamError("auth", `OpenAI rejected the API key: ${detail}`, res.status);
      if (res.status === 404) throw new UpstreamError("model", `OpenAI returned 404: ${detail}`, 404);
      if (res.status === 400 || res.status === 422) {
        const err = new UpstreamError("bad_request", `OpenAI rejected the request: ${detail}`, res.status);
        err.error = json?.error || null;
        throw err;
      }
      lastError = new UpstreamError(res.status === 429 ? "rate_limited" : "unavailable", `OpenAI error ${res.status}: ${detail}`, res.status);
      // Out of credit is a 429 that no retry will fix.
      if (json?.error?.code === "insufficient_quota") throw new UpstreamError("auth", `OpenAI account is out of credit: ${detail}`, 429);
      if (attempt < attempts) await sleep(500 * attempt);
    }
    throw lastError;
  }

  function chatBody({ messages, schemaName, schema, maxTokens, temperature, safetyId }) {
    // (`deadline` on the request is a transport concern and is not sent.)
    const reasoning = Boolean(profile.effort) && profile.effort !== "none";
    const body = { model, messages };
    // Reasoning tokens count against the completion budget, so leave room.
    body[profile.tokensParam] = reasoning ? maxTokens + 1500 : maxTokens;
    if (profile.effort) body.reasoning_effort = profile.effort;
    if (profile.temperature && typeof temperature === "number") body.temperature = temperature;
    if (profile.safetyId && safetyId) body.safety_identifier = safetyId;
    if (profile.structured === "json_schema") {
      body.response_format = { type: "json_schema", json_schema: { name: schemaName, strict: true, schema } };
    } else if (profile.structured === "json_object") {
      body.response_format = { type: "json_object" };
    }
    return body;
  }

  return {
    model,
    profile,

    // -> { content, refusal, tokensIn, tokensOut, truncated }
    async chat(request) {
      for (let adaptations = 0; ; adaptations++) {
        try {
          const json = await call("POST", "/chat/completions", chatBody(request), { deadline: request.deadline });
          const choice = json?.choices?.[0];
          return {
            content: typeof choice?.message?.content === "string" ? choice.message.content : "",
            refusal: choice?.message?.refusal || null,
            truncated: choice?.finish_reason === "length",
            tokensIn: Number(json?.usage?.prompt_tokens) || 0,
            tokensOut: Number(json?.usage?.completion_tokens) || 0,
          };
        } catch (err) {
          if (err instanceof UpstreamError && err.kind === "bad_request" && adaptations < 5 && adaptProfile(profile, err.error)) {
            logger?.warn({ model, profile, reason: err.message }, "adjusted OpenAI request parameters for this model");
            continue;
          }
          throw err;
        }
      }
    },

    // -> boolean[] (true = flagged). Fails open: a moderation outage must not
    // take generation down with it.
    async moderate(inputs) {
      if (!config.openai.moderation || !inputs.length) return inputs.map(() => false);
      try {
        const json = await call(
          "POST",
          "/moderations",
          { model: config.openai.moderationModel, input: inputs },
          { attempts: 1, timeout: Math.min(timeoutMs, 8000) },
        );
        return inputs.map((_, i) => Boolean(json?.results?.[i]?.flagged));
      } catch (err) {
        logger?.warn({ reason: err.message }, "moderation check failed, continuing without it");
        return inputs.map(() => false);
      }
    },

    // Boot-time check that the configured model exists for this API key.
    // Throws on a definite "no" (bad key, unknown model); only warns when
    // OpenAI could not be reached.
    async verifyModel() {
      try {
        const info = await call("GET", `/models/${encodeURIComponent(model)}`, null, { attempts: 2, timeout: 10_000 });
        const shutdown = info?.shutdown_date || info?.deprecation_date || null;
        if (shutdown) logger?.warn({ model, shutdown }, "the configured OpenAI model has a shutdown date: plan to change OPENAI_MODEL");
        else logger?.info({ model }, "OpenAI model verified");
        return { ok: true, shutdown };
      } catch (err) {
        if (err instanceof UpstreamError && err.kind === "model") {
          throw new Error(`OPENAI_MODEL "${model}" is not available to this API key. Set OPENAI_MODEL to a current model.`);
        }
        if (err instanceof UpstreamError && err.kind === "auth") throw new Error(err.message);
        logger?.warn({ reason: err.message }, "could not verify the OpenAI model at boot");
        return { ok: false };
      }
    },
  };
}
