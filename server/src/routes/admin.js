// Admin dashboard: how many installs there are and how many drafts they wrote.
// Disabled entirely (404) unless ADMIN_TOKEN is set.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { errors } from "../errors.js";
import { num } from "../db/index.js";
import { safeEqual } from "../services/crypto.js";
import { KINDS, utcDay } from "../services/devices.js";

const UI_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "admin-ui");
const UI_FILES = {
  "": ["index.html", "text/html; charset=utf-8"],
  "admin.js": ["admin.js", "text/javascript; charset=utf-8"],
  "admin.css": ["admin.css", "text/css; charset=utf-8"],
};
const UI_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";
const DAYS = 30;

export async function registerAdminRoutes(app, { config, db, limiters, clock }) {
  if (!config.adminToken) {
    app.log.warn("ADMIN_TOKEN is not set: the admin dashboard is disabled.");
    return;
  }

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

  app.get("/admin/api/stats", { preValidation: requireAdmin }, async (req) => {
    const now = clock();
    const today = utcDay(now);
    const since = utcDay(now - (DAYS - 1) * 86_400_000);

    const [installs, installsByDay, drafts, draftsTotal, versions] = await Promise.all([
      db.query(
        `SELECT count(*)::int AS total,
                (count(*) FILTER (WHERE created_at > now() - interval '24 hours'))::int AS new24h,
                (count(*) FILTER (WHERE created_at > now() - interval '7 days'))::int AS new7d,
                (count(*) FILTER (WHERE last_seen_at > now() - interval '24 hours'))::int AS active24h,
                (count(*) FILTER (WHERE last_seen_at > now() - interval '7 days'))::int AS active7d,
                (count(*) FILTER (WHERE last_seen_at > now() - interval '30 days'))::int AS active30d,
                (count(*) FILTER (WHERE total_generations > 0))::int AS writers
         FROM devices`,
      ),
      db.query(
        `SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS day, count(*)::int AS n
         FROM devices WHERE created_at >= $1::date GROUP BY 1`,
        [since],
      ),
      db.query(
        `SELECT day, subject, count FROM usage_daily
         WHERE day >= $1 AND (subject = 'drafts' OR subject LIKE 'drafts:%')`,
        [since],
      ),
      db.query(`SELECT COALESCE(sum(count), 0)::bigint AS n FROM usage_daily WHERE subject = 'drafts'`),
      db.query(
        `SELECT COALESCE(client_version, 'unknown') AS version, count(*)::int AS n FROM devices
         WHERE last_seen_at > now() - interval '30 days' GROUP BY 1 ORDER BY n DESC LIMIT 6`,
      ),
    ]);

    // One row per day, newest first, including days with nothing.
    const rows = new Map();
    for (let i = 0; i < DAYS; i++) {
      const day = utcDay(now - i * 86_400_000);
      rows.set(day, { day, installs: 0, drafts: 0, kinds: Object.fromEntries(KINDS.map((k) => [k, 0])) });
    }
    for (const r of installsByDay.rows) if (rows.has(r.day)) rows.get(r.day).installs = num(r.n);
    for (const r of drafts.rows) {
      const row = rows.get(r.day);
      if (!row) continue;
      if (r.subject === "drafts") row.drafts = num(r.count);
      else {
        const kind = r.subject.slice("drafts:".length);
        if (kind in row.kinds) row.kinds[kind] = num(r.count);
      }
    }
    const days = [...rows.values()];
    const pick = (row, keys) => Object.fromEntries(keys.map((k) => [k, num(row[k.toLowerCase()])]));
    const last7 = days.slice(0, 7).reduce((n, d) => n + d.drafts, 0);

    return {
      today: days.find((d) => d.day === today),
      installs: pick(installs.rows[0], ["total", "new24h", "new7d", "active24h", "active7d", "active30d", "writers"]),
      drafts: { total: num(draftsTotal.rows[0].n), last7d: last7 },
      days,
      kinds: KINDS,
      versions: versions.rows.map((r) => ({ version: r.version, installs: num(r.n) })),
      // How the server sees the admin's own address. If this shows a private
      // proxy address instead of your public IP, CLIENT_IP_HEADER is wrong
      // for this host and every install shares one rate-limit bucket.
      caller: { address: req.net.ip, source: req.net.source },
    };
  });
}
