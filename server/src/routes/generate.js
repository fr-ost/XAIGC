// POST /v1/generate: the one endpoint that spends money.
//
// Order of checks, cheapest first:
//   network rate limit (app hook) -> device token -> body validation ->
//   per-device rate limit -> one-at-a-time + cooldown -> quota reservation ->
//   model call -> output moderation.
// A failed model call refunds the reservation; a moderation block does not.

import { randomUUID } from "node:crypto";
import { ApiError, errors } from "../errors.js";
import { EngineError } from "../engine/index.js";
import { KINDS, LANGUAGES, TONES } from "../engine/prompts.js";
import { hmac } from "../services/crypto.js";
import { getDevice, touchDevice } from "../services/devices.js";
import { attachAccountLicense } from "../services/licenses.js";
import { buildAccount, reserve, resolveEntitlement } from "../services/quota.js";

const text = (max, min = 0) => ({ type: "string", minLength: min, maxLength: max });

const bodySchema = {
  type: "object",
  required: ["kind"],
  additionalProperties: false,
  properties: {
    kind: { type: "string", enum: Object.keys(KINDS) },
    post: {
      type: "object",
      required: ["text"],
      additionalProperties: false,
      properties: {
        author: text(40),
        text: text(4000, 1),
        extra: { type: "array", maxItems: 6, items: text(600) },
      },
    },
    idea: text(1000),
    draft: text(1200),
    options: {
      type: "object",
      additionalProperties: false,
      properties: {
        tone: text(20),
        persona: text(600),
        length: { type: "string", enum: ["short", "medium", "long"] },
        language: text(8),
        emoji: { type: "string", enum: ["auto", "none", "allow"] },
        tweets: { type: "integer", minimum: 3, maximum: 10 },
      },
    },
    recent: { type: "array", maxItems: 8, items: text(400) },
    rejected: { type: "array", maxItems: 4, items: text(400) },
    // SHA-256 of the signed-in X handle, computed in the extension. The raw
    // handle never reaches the server.
    xh: { type: "string", pattern: "^[a-f0-9]{64}$" },
  },
};

// Semantic validation and normalization after the schema check.
function normalize(body) {
  const kind = body.kind;
  const needs = KINDS[kind].needs;
  const input = { kind };
  const blank = (s) => !String(s || "").trim();

  if (needs === "post") {
    if (!body.post || blank(body.post.text)) throw errors.badRequest("This needs the text of the post you are replying to.");
    input.post = {
      author: body.post.author || "",
      text: body.post.text.trim(),
      extra: (body.post.extra || []).filter((e) => !blank(e)),
    };
  } else if (needs === "idea") {
    if (blank(body.idea) || body.idea.trim().length < 3) throw errors.badRequest("Describe what the post should be about.");
    input.idea = body.idea.trim();
  } else {
    if (blank(body.draft) || body.draft.trim().length < 3) throw errors.badRequest("Write a draft first, then rewrite it.");
    input.draft = body.draft.trim();
  }

  const o = body.options || {};
  input.options = {
    tone: Object.hasOwn(TONES, o.tone) ? o.tone : "auto",
    persona: String(o.persona || "").trim(),
    length: o.length || "medium",
    language: o.language === "auto" || Object.hasOwn(LANGUAGES, o.language) ? o.language : "en",
    emoji: o.emoji || "auto",
    tweets: o.tweets || 5,
  };
  input.recent = (body.recent || []).filter((s) => !blank(s));
  input.rejected = (body.rejected || []).filter((s) => !blank(s));
  return input;
}

// True when `version` is missing or lower than `minimum` (dotted numbers).
export function olderThan(version, minimum) {
  const parse = (v) => String(v || "").split(".").map((n) => Number.parseInt(n, 10) || 0);
  const a = parse(version);
  const b = parse(minimum);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) < (b[i] || 0);
  }
  return false;
}

function quotaError(reason, account) {
  switch (reason) {
    case "daily_limit":
      return new ApiError(429, "daily_limit", `You've used all ${account.quota.limit} generations for today. The limit resets at 00:00 UTC.`, {
        resetsAt: account.quota.resetsAt,
        account,
      });
    case "free_network_limit":
      return errors.paymentRequired("free_limit", "Today's free comments for this network are used up. They come back at 00:00 UTC. For more today, get a plan.", {
        resetsAt: account.quota.resetsAt,
        account,
      });
    case "free_capacity":
      return new ApiError(503, "free_busy", "The free plan is at capacity for today. Try again tomorrow, or get a plan to keep going.", { account });
    case "capacity":
      return new ApiError(503, "capacity", "XAICG is at capacity for today. Try again later.", { account });
    default:
      return errors.paymentRequired(
        "free_limit",
        `You've used today's ${account.quota.limit} free comments. They come back at 00:00 UTC. For more today, get a plan.`,
        { resetsAt: account.quota.resetsAt, account },
      );
  }
}

function engineError(err) {
  switch (err.code) {
    case "content_blocked":
      return new ApiError(422, "content_blocked", "That couldn't be written safely. Try a different post or wording.");
    case "no_usable_output":
      return new ApiError(502, "generation_failed", "The AI didn't return anything usable. Try again.");
    case "upstream_busy":
      return new ApiError(503, "upstream_busy", "The AI provider is busy. Try again in a few seconds.", { retryAfter: 5 });
    case "upstream_timeout":
      return new ApiError(504, "upstream_timeout", "The AI provider took too long. Try again.");
    case "upstream_auth":
      return new ApiError(503, "service_unavailable", "XAICG is temporarily unavailable. Try again later.");
    default:
      return new ApiError(502, "upstream_error", "The AI provider had a problem. Try again.");
  }
}

export function registerGenerateRoute(app, { config, db, engine, limiters, gate, clock, requireDevice }) {
  async function recordEvent(req, fields) {
    try {
      await db.query(
        `INSERT INTO usage_events (device_id, license_id, plan, kind, status, model, tokens_in, tokens_out, latency_ms, ip_hash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          fields.deviceId,
          fields.licenseId,
          fields.plan,
          fields.kind,
          fields.status,
          engine.model,
          fields.tokensIn || 0,
          fields.tokensOut || 0,
          fields.latencyMs || 0,
          req.net.hash,
        ],
      );
    } catch (err) {
      req.log.warn({ err }, "could not record usage event");
    }
  }

  app.post("/v1/generate", { preValidation: requireDevice, schema: { body: bodySchema } }, async (req) => {
    let device = req.device;
    if (config.minClientVersion && olderThan(req.headers["x-xaigc-client"], config.minClientVersion)) {
      throw new ApiError(426, "update_required", "This version of XAICG is out of date. Update the extension to keep generating.");
    }
    const input = normalize(req.body);

    const rate = limiters.device.take(device.id);
    if (!rate.ok) throw errors.tooMany("rate_limited", "You're generating very fast. Give it a few seconds.", rate.retryAfterMs);

    const slot = gate.enter(device.id);
    if (!slot.ok) {
      throw slot.code === "busy"
        ? errors.tooMany("busy", "A generation is already running. Wait for it to finish.", slot.retryAfterMs)
        : errors.tooMany("cooldown", "Slow down a moment before generating again.", slot.retryAfterMs);
    }

    // Once the model has been called, the cooldown applies whatever the
    // outcome, so a failing request cannot be hammered in a tight loop.
    let invoked = false;
    try {
      const now = clock();
      // A signed-in browser with no license of its own takes its account's
      // license first, so one granted a moment ago works on the very next click.
      let waiting = null;
      if (device.user && resolveEntitlement(config, device.license, now).mode === "free") {
        try {
          const result = await attachAccountLicense(db, config, { device, ipHash: req.net.hash });
          waiting = result.waiting;
          if (result.attached) device = (await getDevice(db, device.id)) || device;
        } catch (err) {
          req.log.warn({ err }, "could not attach the account's license");
        }
      }
      const entitlement = resolveEntitlement(config, device.license, now);
      if (entitlement.mode === "free" && config.free.requireSignIn && !device.user) {
        throw errors.forbidden("sign_in_required", "Sign in with Google to get your free comments.");
      }
      // An install stays tied to the X account it last reported, so leaving
      // the field out later (the compose popup has no page to read it from)
      // does not open a second free allowance.
      const xhHash = req.body.xh ? hmac(config.appSecret, `xh:${req.body.xh}`) : device.xh_hash || null;
      const event = {
        deviceId: device.id,
        licenseId: entitlement.mode === "license" ? entitlement.license.id : null,
        plan: entitlement.mode === "license" ? entitlement.plan.id : "free",
        kind: input.kind,
      };

      if (entitlement.mode === "free" && config.free.requireHandle && !xhHash) {
        throw errors.badRequest("Open X and sign in to use the free plan.", "x_account_required");
      }

      const reservation = await reserve(db, config, { device, entitlement, ipHash: req.net.hash, xhHash, now });
      if (!reservation.ok) {
        const account = await buildAccount(db, config, { device, ipHash: req.net.hash, xhHash, now, waiting });
        await recordEvent(req, { ...event, status: `denied:${reservation.reason}` });
        throw quotaError(reservation.reason, account);
      }

      const started = Date.now();
      let result;
      try {
        // A stable pseudonymous id lets OpenAI attribute abuse to one end
        // user instead of to the whole account.
        const safetyId = hmac(config.appSecret, `safety:${event.licenseId || device.id}`);
        invoked = true;
        result = await engine.generate(input, { safetyId });
      } catch (err) {
        const latencyMs = Date.now() - started;
        if (err instanceof EngineError) {
          try {
            // A blocked result is never refunded. A failure the model was
            // already paid for is refunded only a few times an hour per
            // install and per network: otherwise an input that reliably
            // yields unusable output would be a free way to burn the OpenAI
            // budget without ever touching a quota.
            const paid = err.usage.tokensIn + err.usage.tokensOut > 0;
            const refundable =
              err.code !== "content_blocked" &&
              (!paid || (limiters.paidFailure.take(`dev:${device.id}`).ok && limiters.paidFailure.take(`ip:${req.net.group}`).ok));
            if (refundable) await reservation.refund();
            await reservation.addTokens(err.usage.tokensIn, err.usage.tokensOut);
          } catch (bookkeeping) {
            req.log.error({ err: bookkeeping }, "refund failed");
          }
          await recordEvent(req, { ...event, status: err.code, latencyMs, ...err.usage });
          if (err.code === "upstream_auth") req.log.error({ reason: err.message }, "OpenAI configuration problem");
          else req.log.warn({ code: err.code, reason: err.message }, "generation failed");
          throw engineError(err);
        }
        await reservation.refund();
        await recordEvent(req, { ...event, status: "error", latencyMs });
        throw err;
      }

      const latencyMs = Date.now() - started;
      // The text exists and has been paid for. Bookkeeping problems from
      // here on are logged, never turned into a failed request.
      try {
        await reservation.addTokens(result.tokensIn, result.tokensOut);
        await touchDevice(db, device.id, {
          ipHash: req.net.hash,
          xhHash,
          clientVersion: String(req.headers["x-xaigc-client"] || "").slice(0, 20) || null,
          generated: true,
        });
      } catch (err) {
        req.log.warn({ err }, "post-generation bookkeeping failed");
      }
      await recordEvent(req, { ...event, status: "ok", latencyMs, tokensIn: result.tokensIn, tokensOut: result.tokensOut });

      const account = await buildAccount(db, config, { device, ipHash: req.net.hash, xhHash, now: clock(), waiting });
      const payload = { id: `gen_${randomUUID()}`, kind: input.kind, account };
      if (result.thread) payload.thread = result.thread;
      else payload.variants = result.variants;
      return payload;
    } finally {
      gate.leave(device.id, { countCooldown: invoked });
    }
  });
}
