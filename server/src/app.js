// Fastify application: request context, abuse controls, error handling, routes.

import net from "node:net";
import Fastify from "fastify";
import cors from "@fastify/cors";

import { ApiError, errors } from "./errors.js";
import { hmac, ipGroup } from "./services/crypto.js";
import { createActivityGate, createLimiter } from "./services/ratelimit.js";
import { authenticateDevice } from "./services/devices.js";
import { registerPublicRoutes } from "./routes/public.js";
import { registerGenerateRoute } from "./routes/generate.js";
import { registerAdminRoutes } from "./routes/admin.js";

const MINUTE = 60_000;

export async function buildApp({ config, db, engine, clock = Date.now }) {
  const app = Fastify({
    logger:
      config.logLevel === "silent"
        ? false
        : { level: config.logLevel, redact: ["req.headers.authorization", "req.headers.cookie"] },
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

  function clientIp(req) {
    if (config.clientIpHeader) {
      const raw = req.headers[config.clientIpHeader];
      const value = String(Array.isArray(raw) ? raw[0] : raw || "").split(",")[0].trim();
      if (net.isIP(value)) return value;
    }
    return req.ip;
  }

  app.decorateRequest("net", null);
  app.decorateRequest("device", null);

  app.addHook("onRequest", async (req) => {
    const group = ipGroup(clientIp(req));
    // The raw address is used for in-memory rate limiting only. Anything
    // written to the database is the keyed hash.
    req.net = { group, hash: hmac(config.appSecret, `ip:${group}`) };

    const path = req.url.split("?")[0];
    const guarded = path.startsWith("/v1/") || path.startsWith("/admin/api/");
    if (!guarded || req.method === "OPTIONS") return;

    const hit = limiters.ip.take(group);
    if (!hit.ok) throw errors.tooMany("rate_limited", "Too many requests from this network. Slow down a little.", hit.retryAfterMs);

    // With an allowlist configured, only the published extension may call
    // the API from a browser context.
    if (path.startsWith("/v1/") && config.allowedOrigins.length) {
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
    req.device = device;
  }

  const ctx = { config, db, engine, limiters, gate, clock, requireDevice };

  /* ------------------------------- routes --------------------------------- */

  app.get("/", async () => ({
    name: "XAIGC API",
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
  registerGenerateRoute(app, ctx);
  await registerAdminRoutes(app, ctx);

  return app;
}
