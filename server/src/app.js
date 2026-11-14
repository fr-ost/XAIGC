// Fastify application: request context, abuse controls, error handling, routes.

import net from "node:net";
import Fastify from "fastify";
import cors from "@fastify/cors";

import { ApiError, errors } from "./errors.js";
import { hmac, ipGroup } from "./services/crypto.js";
import { createActivityGate, createLimiter } from "./services/ratelimit.js";
import { authenticateDevice } from "./services/devices.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerAuthRoutes } from "./routes/auth.js";
import { registerGenerateRoute } from "./routes/generate.js";
import { registerAdminRoutes } from "./routes/admin.js";

const MINUTE = 60_000;

export async function buildApp({ config, db, engine, clock = Date.now, fetchImpl = globalThis.fetch }) {
  const app = Fastify({
    logger:
      config.logLevel === "silent"
        ? false
        : {
            level: config.logLevel,
            // Log the path only. Query strings can carry an email address or
            // a pasted license key (admin search), and bodies carry post text.
            serializers: {
              req: (req) => ({ method: req.method, url: String(req.url || "").split("?")[0] }),
            },
          },
    trustProxy: config.trustProxy,
    // Request logs carry method, path and status only. Bodies (post text) are
    // never logged.
    bodyLimit: config.limits.bodyBytes,
  });

  const limiters = {
    ip: createLimiter({ limit: config.limits.ipPerMinute, windowMs: MINUTE, now: clock }),
    device: createLimiter({ limit: config.limits.devicePerMinute, windowMs: MINUTE, now: clock }),
    register: createLimiter({ limit: config.limits.registerPerIpPerHour, windowMs: 60 * MINUTE, now: clock }),
    activateFail: createLimiter({ limit: config.limits.activateFailuresPer15Min, windowMs: 15 * MINUTE, now: clock }),
    adminFail: createLimiter({ limit: config.limits.adminFailuresPer15Min, windowMs: 15 * MINUTE, now: clock }),
    paidFailure: createLimiter({ limit: config.limits.refundedFailuresPerHour, windowMs: 60 * MINUTE, now: clock }),
    signInStart: createLimiter({ limit: config.limits.signInStartsPer10Min, windowMs: 10 * MINUTE, now: clock }),
  };
  const gate = createActivityGate({ cooldownMs: config.limits.cooldownMs, now: clock });

  const sweeper = setInterval(() => {
    for (const limiter of Object.values(limiters)) limiter.sweep();
    gate.sweep();
  }, MINUTE);
  sweeper.unref();
  app.addHook("onClose", async () => clearInterval(sweeper));

  /* ------------------------------- origins -------------------------------- */

  const isExtensionOrigin = (origin) => /^(chrome|moz)-extension:\/\/[a-z0-9-]+$/i.test(origin);
  function originAllowed(origin) {
    if (config.allowedOrigins.length) return config.allowedOrigins.includes(origin);
    if (isExtensionOrigin(origin)) return true;
    return !config.production && /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  }

  await app.register(cors, {
    origin: (origin, cb) => cb(null, Boolean(origin) && originAllowed(origin)),
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "X-XAIGC-Client"],
    maxAge: 86_400,
  });

  /* --------------------------- request context ---------------------------- */

  // Where is the caller? Preferred: the header the platform's edge sets
  // (X-Real-IP on Railway). For a list header such as X-Forwarded-For the
  // LAST entry is used: that is the hop the nearest proxy appended, and the
  // only one a client cannot forge. If the configured header is absent, fall
  // back to the last X-Forwarded-For hop, then to the socket address, and say
  // so once: behind a proxy the socket address is the proxy itself, which
  // would put every user in one rate-limit bucket.
  let warnedAboutIp = false;
  function clientIp(req) {
    const lastHop = (name) => {
      const raw = req.headers[name];
      return String(Array.isArray(raw) ? raw[raw.length - 1] : raw || "").split(",").pop().trim();
    };
    if (config.clientIpHeader) {
      const value = lastHop(config.clientIpHeader);
      if (net.isIP(value)) return { ip: value, source: config.clientIpHeader };
      const forwarded = lastHop("x-forwarded-for");
      if (!warnedAboutIp) {
        warnedAboutIp = true;
        req.log.warn(
          { expected: config.clientIpHeader, fallback: net.isIP(forwarded) ? "x-forwarded-for" : "socket" },
          "client IP header missing on a request: check CLIENT_IP_HEADER for this platform",
        );
      }
      if (net.isIP(forwarded)) return { ip: forwarded, source: "x-forwarded-for" };
    }
    return { ip: req.ip, source: "socket" };
  }

  app.decorateRequest("net", null);
  app.decorateRequest("device", null);

  app.addHook("onRequest", async (req) => {
    const caller = clientIp(req);
    const group = ipGroup(caller.ip);
    // The raw address is used for in-memory rate limiting only. Anything
    // written to the database is the keyed hash.
    req.net = { group, hash: hmac(config.appSecret, `ip:${group}`), ip: caller.ip, source: caller.source };

    // Decide by the route that matched, never by the raw URL. The router
    // decodes percent-encoding, so "/%761/me" reaches /v1/me and would walk
    // straight past a string test on req.url.
    const route = req.routeOptions?.url || "";
    if (req.method === "OPTIONS" || route === "/health") return;

    const hit = limiters.ip.take(group);
    if (!hit.ok) throw errors.tooMany("rate_limited", "Too many requests from this network. Slow down a little.", hit.retryAfterMs);

    // With an allowlist configured, only the published extension may make
    // state-changing calls. GET is exempt: Chrome sends no Origin header on
    // an extension's GET requests. That is safe because GET /v1/me changes
    // nothing: it only describes the caller's own account.
    if (route.startsWith("/v1/") && req.method !== "GET" && config.allowedOrigins.length) {
      const origin = req.headers.origin || "";
      if (!config.allowedOrigins.includes(origin)) {
        throw errors.forbidden("origin_not_allowed", "This client is not allowed to use the API.");
      }
    }
  });

  app.addHook("onSend", async (req, reply) => {
    reply.header("X-Content-Type-Options", "nosniff");
    reply.header("Referrer-Policy", "no-referrer");
    reply.header("X-Frame-Options", "DENY");
    if (config.production) reply.header("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    if (!reply.hasHeader("Cache-Control")) reply.header("Cache-Control", "no-store");
  });

  /* ------------------------------- errors --------------------------------- */

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof ApiError) {
      if (err.extra?.retryAfter) reply.header("Retry-After", String(err.extra.retryAfter));
      return reply.code(err.status).send({ error: { code: err.code, message: err.message, ...err.extra } });
    }
    if (err.validation) {
      const first = err.validation[0];
      const where = first?.instancePath ? first.instancePath.slice(1).replace(/\//g, ".") : first?.params?.missingProperty || "body";
      return reply.code(400).send({ error: { code: "invalid_request", message: `Invalid request: ${where} ${first?.message || "is invalid"}.` } });
    }
    if (err.statusCode === 413) {
      return reply.code(413).send({ error: { code: "payload_too_large", message: "Request is too large." } });
    }
    if (err.statusCode && err.statusCode >= 400 && err.statusCode < 500) {
      return reply.code(err.statusCode).send({ error: { code: "bad_request", message: err.message } });
    }
    req.log.error({ err }, "unhandled error");
    return reply.code(500).send({ error: { code: "server_error", message: "Something went wrong on our side. Try again." } });
  });

  app.setNotFoundHandler((req, reply) => {
    reply.code(404).send({ error: { code: "not_found", message: "Not found." } });
  });

  /* -------------------------------- auth ---------------------------------- */

  async function requireDevice(req) {
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(\S+)$/i);
    if (!match) throw errors.unauthorized();
    const device = await authenticateDevice(db, match[1]);
    if (!device) throw errors.unauthorized();
    if (device.blocked) throw errors.forbidden("device_blocked", "This install has been blocked. Contact support.");
    if (device.user?.blocked) throw errors.forbidden("account_blocked", "This account has been blocked. Contact support.");
    req.device = device;
  }

  const ctx = { config, db, engine, limiters, gate, clock, requireDevice, fetchImpl };

  /* ------------------------------- routes --------------------------------- */

  app.get("/", async () => ({
    name: "XAICG API",
    version: config.version,
    product: "A product of Unique Labs",
    developer: "Shahriar Ahmed",
    website: config.links.website,
  }));

  app.get("/health", async (req, reply) => {
    try {
      await db.query("SELECT 1");
      return { ok: true, version: config.version };
    } catch (err) {
      req.log.error({ err }, "health check failed");
      return reply.code(503).send({ ok: false });
    }
  });

  registerPublicRoutes(app, ctx);
  await registerAuthRoutes(app, ctx);
  registerGenerateRoute(app, ctx);
  await registerAdminRoutes(app, ctx);

  return app;
}
