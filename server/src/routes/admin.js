// Admin API and dashboard. Disabled entirely (404) unless ADMIN_TOKEN is set.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { errors } from "../errors.js";
import { num } from "../db/index.js";
import { safeEqual } from "../services/crypto.js";
import { setDeviceBlocked } from "../services/devices.js";
import { deleteUser, getUserDetail, listUsers, setUserBlocked } from "../services/users.js";
import {
  createLicense,
  getLicenseDetail,
  licenseState,
  listLicenses,
  planFor,
  resetLicenseDevices,
  rotateLicenseKey,
  updateLicense,
} from "../services/licenses.js";
import { utcDay } from "../services/quota.js";

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "admin-ui");
const UI_FILES = {
  "": ["index.html", "text/html; charset=utf-8"],
  "admin.js": ["admin.js", "text/javascript; charset=utf-8"],
  "admin.css": ["admin.css", "text/css; charset=utf-8"],
};
const UI_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

const iso = (v) => (v ? new Date(v).toISOString() : null);
const uuidParam = { type: "object", required: ["id"], properties: { id: { type: "string", format: "uuid" } } };
const nullableInt = (min, max) => ({ type: ["integer", "null"], minimum: min, maximum: max });

function serializeLicense(config, row) {
  const plan = planFor(config, row);
  return {
    id: row.id,
    hint: row.key_hint,
    plan: row.plan,
    planLabel: plan.label,
    state: licenseState(row),
    email: row.email,
    note: row.note,
    maxDevices: plan.maxDevices,
    dailyLimit: plan.dailyLimit,
    overrides: { maxDevices: row.max_devices, dailyLimit: row.daily_limit },
    expiresAt: iso(row.expires_at),
    durationDays: row.duration_days,
    firstActivatedAt: iso(row.first_activated_at),
    createdAt: iso(row.created_at),
    devicesUsed: row.devices_used === undefined ? undefined : num(row.devices_used),
    usedToday: row.used_today === undefined ? undefined : num(row.used_today),
    // The Google account this license belongs to, if any.
    owner: row.user_id ? { id: row.user_id, email: row.owner_email || null } : null,
  };
}

function serializeUser(config, row) {
  const plan = row.plan ? config.plans[row.plan]?.label || row.plan : null;
  return {
    id: row.id,
    email: row.email,
    name: row.name,
    blocked: row.blocked,
    blockedReason: row.blocked_reason,
    createdAt: iso(row.created_at),
    lastLoginAt: iso(row.last_login_at),
    lastSeenAt: iso(row.last_seen_at),
    devices: num(row.devices),
    generations: num(row.generations),
    activeLicenses: num(row.active_licenses),
    plan,
    // Free comments used today, out of the daily allowance.
    free: { used: Math.min(num(row.free_used), config.free.dailyLimit), limit: config.free.dailyLimit },
  };
}

export async function registerAdminRoutes(app, { config, db, limiters, clock }) {
  if (!config.adminToken) {
    app.log.warn("ADMIN_TOKEN is not set: the admin API and dashboard are disabled.");
    return;
  }

  /* ------------------------------ dashboard ------------------------------- */

  const assets = {};
  for (const [route, [file, type]] of Object.entries(UI_FILES)) {
    assets[route] = { body: await readFile(path.join(UI_DIR, file)), type };
  }
  const serve = (route) => async (req, reply) => {
    reply.header("Content-Security-Policy", UI_CSP).header("Cache-Control", "no-cache").type(assets[route].type);
    return assets[route].body;
  };
  app.get("/admin", serve(""));
  app.get("/admin/admin.js", serve("admin.js"));
  app.get("/admin/admin.css", serve("admin.css"));

  /* --------------------------------- auth --------------------------------- */

  // The token is compared first and a correct one always gets in. Only
  // requests that present a wrong token are counted, so neither a flood of
  // bad guesses nor a page that makes the admin's browser fire token-less
  // requests can lock the real admin out.
  async function requireAdmin(req) {
    const match = String(req.headers.authorization || "").match(/^Bearer\s+(\S+)$/i);
    if (match && safeEqual(match[1], config.adminToken)) return;
    if (match) {
      const miss = limiters.adminFail.take(`admin:${req.net.group}`);
      if (!miss.ok) throw errors.tooMany("too_many_attempts", "Too many failed admin sign-ins. Try again later.", miss.retryAfterMs);
    }
    throw errors.unauthorized("Admin token is missing or wrong.");
  }

  const admin = { preValidation: requireAdmin };

  /* -------------------------------- stats --------------------------------- */

  app.get("/admin/api/stats", admin, async (req) => {
    const day = utcDay(clock());
    const [devices, licenses, series, statuses, users] = await Promise.all([
      db.query(
        `SELECT count(*)::int AS total,
                (count(*) FILTER (WHERE created_at > now() - interval '24 hours'))::int AS new24h,
                (count(*) FILTER (WHERE last_seen_at > now() - interval '24 hours'))::int AS active24h,
                (count(*) FILTER (WHERE license_id IS NOT NULL))::int AS licensed,
                (count(*) FILTER (WHERE blocked))::int AS blocked
         FROM devices`,
      ),
      db.query(
        `SELECT count(*)::int AS total,
                (count(*) FILTER (WHERE status = 'active' AND (expires_at IS NULL OR expires_at > now())))::int AS active,
                (count(*) FILTER (WHERE status = 'active' AND expires_at IS NOT NULL AND expires_at <= now()))::int AS expired,
                (count(*) FILTER (WHERE status = 'revoked'))::int AS revoked
         FROM licenses`,
      ),
      db.query(
        `SELECT day, subject, count, tokens_in, tokens_out FROM usage_daily
         WHERE subject IN ('global', 'global:trial') ORDER BY day DESC LIMIT 28`,
      ),
      db.query(
        `SELECT status, count(*)::int AS n FROM usage_events
         WHERE ts > now() - interval '24 hours' GROUP BY status ORDER BY n DESC`,
      ),
      db.query(
        `SELECT count(*)::int AS total,
                (count(*) FILTER (WHERE created_at > now() - interval '24 hours'))::int AS new24h,
                (count(*) FILTER (WHERE last_login_at > now() - interval '7 days'))::int AS active7d,
                (count(*) FILTER (WHERE blocked))::int AS blocked
         FROM users`,
      ),
    ]);

    const byDay = new Map();
    for (const r of series.rows) {
      const d = byDay.get(r.day) || { day: r.day, total: 0, free: 0, tokensIn: 0, tokensOut: 0 };
      if (r.subject === "global") {
        d.total = num(r.count);
        d.tokensIn = num(r.tokens_in);
        d.tokensOut = num(r.tokens_out);
      } else d.free = num(r.count);
      byDay.set(r.day, d);
    }
    const cost = (d) => (d.tokensIn / 1e6) * config.openai.priceInPerM + (d.tokensOut / 1e6) * config.openai.priceOutPerM;
    const days = [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).map((d) => ({ ...d, paid: d.total - d.free, costUsd: cost(d) }));
    const today = days.find((d) => d.day === day) || { day, total: 0, free: 0, paid: 0, tokensIn: 0, tokensOut: 0, costUsd: 0 };

    const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, num(row[k.toLowerCase()])]));
    return {
      today,
      days,
      devices: pick(devices.rows[0], ["total", "new24h", "active24h", "licensed", "blocked"]),
      licenses: pick(licenses.rows[0], ["total", "active", "expired", "revoked"]),
      users: pick(users.rows[0], ["total", "new24h", "active7d", "blocked"]),
      signIn: { google: config.google.enabled, requiredForFree: config.free.requireSignIn },
      outcomes24h: statuses.rows.map((r) => ({ status: r.status, count: num(r.n) })),
      model: config.openai.model,
      caps: config.caps,
      free: config.free,
      priced: config.openai.priceInPerM > 0 || config.openai.priceOutPerM > 0,
      // How the server sees the admin's own address. If this shows a private
      // proxy address instead of your public IP, CLIENT_IP_HEADER is wrong
      // for this host and every user is sharing one rate-limit bucket.
      caller: { address: req.net.ip, source: req.net.source },
    };
  });

  app.get("/admin/api/plans", admin, async () => ({
    plans: Object.entries(config.plans).map(([id, p]) => ({ id, ...p })),
  }));

  /* ------------------------------- licenses ------------------------------- */

  app.get(
    "/admin/api/licenses",
    {
      ...admin,
      schema: {
        querystring: {
          type: "object",
          properties: {
            q: { type: "string", maxLength: 120 },
            status: { type: "string", enum: ["", "active", "expired", "revoked"] },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
        },
      },
    },
    async (req) => {
      const { q = "", status = "", limit, offset } = req.query;
      const result = await listLicenses(db, { q: q.trim(), status, limit, offset, day: utcDay(clock()) });
      return { total: result.total, licenses: result.licenses.map((row) => serializeLicense(config, row)) };
    },
  );

  app.post(
    "/admin/api/licenses",
    {
      ...admin,
      schema: {
        body: {
          type: "object",
          required: ["plan"],
          additionalProperties: false,
          properties: {
            plan: { type: "string", maxLength: 32 },
            email: { type: "string", maxLength: 254 },
            userId: { type: "string", format: "uuid" }, // issue to this account (its email is used)
            note: { type: "string", maxLength: 500 },
            days: nullableInt(1, 36500),
            expiresAt: { type: ["string", "null"], maxLength: 40 },
            maxDevices: nullableInt(1, 1000),
            dailyLimit: nullableInt(1, 1000000),
            count: { type: "integer", minimum: 1, maximum: 100, default: 1 },
          },
        },
      },
    },
    async (req) => {
      const { count, ...input } = req.body;
      const created = [];
      for (let i = 0; i < count; i++) {
        const { license, key } = await createLicense(db, config, input);
        // The only time the full key exists outside the customer's hands.
        created.push({ ...serializeLicense(config, license), key });
      }
      return { licenses: created };
    },
  );

  app.get("/admin/api/licenses/:id", { ...admin, schema: { params: uuidParam } }, async (req) => {
    const detail = await getLicenseDetail(db, req.params.id, { day: utcDay(clock()) });
    return {
      license: serializeLicense(config, detail.license),
      devices: detail.devices.map((d) => ({
        id: d.id,
        activatedAt: iso(d.activated_at),
        lastSeenAt: iso(d.last_seen_at),
        createdAt: iso(d.created_at),
        clientVersion: d.client_version,
        totalGenerations: num(d.total_generations),
        blocked: d.blocked,
      })),
      events: detail.events.map((e) => ({ ts: iso(e.ts), type: e.type, deviceId: e.device_id, detail: e.detail })),
      usage: detail.usage,
      networks24h: detail.networks24h,
    };
  });

  app.patch(
    "/admin/api/licenses/:id",
    {
      ...admin,
      schema: {
        params: uuidParam,
        body: {
          type: "object",
          additionalProperties: false,
          properties: {
            status: { type: "string", enum: ["active", "revoked"] },
            plan: { type: "string", maxLength: 32 },
            expiresAt: { type: ["string", "null"], maxLength: 40 },
            durationDays: nullableInt(1, 36500),
            maxDevices: nullableInt(1, 1000),
            dailyLimit: nullableInt(1, 1000000),
            email: { type: ["string", "null"], maxLength: 254 },
            note: { type: ["string", "null"], maxLength: 500 },
            userId: { type: "null" }, // null removes the owning account
          },
        },
      },
    },
    async (req) => ({ license: serializeLicense(config, await updateLicense(db, config, req.params.id, req.body)) }),
  );

  app.post("/admin/api/licenses/:id/rotate", { ...admin, schema: { params: uuidParam } }, async (req) => {
    const { license, key } = await rotateLicenseKey(db, req.params.id);
    return { license: serializeLicense(config, license), key };
  });

  app.post("/admin/api/licenses/:id/reset-devices", { ...admin, schema: { params: uuidParam } }, async (req) => ({
    released: await resetLicenseDevices(db, req.params.id),
  }));

  /* --------------------------------- users -------------------------------- */

  app.get(
    "/admin/api/users",
    {
      ...admin,
      schema: {
        querystring: {
          type: "object",
          properties: {
            q: { type: "string", maxLength: 120 },
            filter: { type: "string", enum: ["", "licensed", "free", "blocked"] },
            limit: { type: "integer", minimum: 1, maximum: 200, default: 50 },
            offset: { type: "integer", minimum: 0, default: 0 },
          },
        },
      },
    },
    async (req) => {
      const { q = "", filter = "", limit, offset } = req.query;
      const result = await listUsers(db, { q: q.trim(), filter, limit, offset, day: utcDay(clock()) });
      return { total: result.total, users: result.users.map((row) => serializeUser(config, row)) };
    },
  );

  app.get("/admin/api/users/:id", { ...admin, schema: { params: uuidParam } }, async (req) => {
    const detail = await getUserDetail(db, req.params.id, { day: utcDay(clock()) });
    return {
      user: serializeUser(config, detail.user),
      devices: detail.devices.map((d) => ({
        id: d.id,
        createdAt: iso(d.created_at),
        lastSeenAt: iso(d.last_seen_at),
        clientVersion: d.client_version,
        totalGenerations: num(d.total_generations),
        blocked: d.blocked,
        license: d.key_hint ? { hint: d.key_hint, plan: config.plans[d.plan]?.label || d.plan } : null,
      })),
      licenses: detail.licenses.map((row) => serializeLicense(config, row)),
    };
  });

  app.post(
    "/admin/api/users/:id/block",
    {
      ...admin,
      schema: {
        params: uuidParam,
        body: {
          type: "object",
          required: ["blocked"],
          additionalProperties: false,
          properties: { blocked: { type: "boolean" }, reason: { type: "string", maxLength: 300 } },
        },
      },
    },
    async (req) => ({ user: await setUserBlocked(db, req.params.id, req.body.blocked, req.body.reason) }),
  );

  app.delete("/admin/api/users/:id", { ...admin, schema: { params: uuidParam } }, async (req) => ({
    deleted: await deleteUser(db, req.params.id),
  }));

  /* -------------------------------- devices ------------------------------- */

  app.post(
    "/admin/api/devices/:id/block",
    {
      ...admin,
      schema: {
        params: uuidParam,
        body: {
          type: "object",
          required: ["blocked"],
          additionalProperties: false,
          properties: { blocked: { type: "boolean" }, reason: { type: "string", maxLength: 300 } },
        },
      },
    },
    async (req) => ({ device: await setDeviceBlocked(db, req.params.id, req.body.blocked, req.body.reason) }),
  );
}
