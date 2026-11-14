// License keys, activation and device binding.
//
// Key format: XAIGC-XXXXX-XXXXX-XXXXX-XXXXX, 20 random characters from the
// Crockford base32 alphabet (no I, L, O, U), which is 100 bits of entropy.
// Only a SHA-256 of the key is stored. A leaked database cannot be turned
// back into working keys, and the key is shown exactly once, at creation.

import { randomBytes, randomUUID } from "node:crypto";
import { ApiError, errors } from "../errors.js";
import { num } from "../db/index.js";
import { sha256 } from "./crypto.js";

const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const BODY_RE = /^[0-9A-HJKMNP-TV-Z]{20}$/;
const FALLBACK_PLAN = { label: "Licensed", dailyLimit: 50, maxDevices: 1 };
const CHURN_WINDOW_MS = 30 * 24 * 60 * 60 * 1000;

export function generateLicenseKey() {
  const bytes = randomBytes(20);
  let body = "";
  for (const b of bytes) body += ALPHABET[b & 31];
  return formatKey(body);
}

function formatKey(body) {
  return `XAIGC-${body.slice(0, 5)}-${body.slice(5, 10)}-${body.slice(10, 15)}-${body.slice(15, 20)}`;
}

// Accepts what people actually paste: lower case, spaces, missing dashes,
// and the usual look-alike typos (O for 0, I or L for 1). Returns the
// canonical key, or null when it cannot be a valid key.
export function normalizeKey(input) {
  let s = String(input || "").toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (s.startsWith("XAIGC")) s = s.slice(5);
  s = s.replace(/O/g, "0").replace(/[IL]/g, "1");
  return BODY_RE.test(s) ? formatKey(s) : null;
}

export function hashKey(canonicalKey) {
  return sha256(`xaigc-license:${canonicalKey}`);
}

export function keyHint(canonicalKey) {
  return `${canonicalKey.slice(0, 11)}-*****-*****-**${canonicalKey.slice(-3)}`;
}

export function planFor(config, license) {
  const plan = config.plans[license.plan] || { ...FALLBACK_PLAN, label: license.plan };
  return {
    id: license.plan,
    label: plan.label,
    dailyLimit: license.daily_limit ?? plan.dailyLimit,
    maxDevices: license.max_devices ?? plan.maxDevices,
  };
}

// 'active' | 'expired' | 'revoked' | 'none'
export function licenseState(license, now = Date.now()) {
  if (!license) return "none";
  if (license.status !== "active") return "revoked";
  if (license.expires_at && new Date(license.expires_at).getTime() <= now) return "expired";
  return "active";
}

async function logEvent(q, licenseId, type, { deviceId = null, detail = null, ipHash = null } = {}) {
  await q.query(
    "INSERT INTO license_events (license_id, device_id, type, detail, ip_hash) VALUES ($1, $2, $3, $4, $5)",
    [licenseId, deviceId, type, detail, ipHash],
  );
}

export async function createLicense(db, config, input) {
  const plan = String(input.plan || "");
  if (!config.plans[plan]) {
    throw errors.badRequest(`Unknown plan "${plan}". Available: ${Object.keys(config.plans).join(", ")}.`);
  }
  let expiresAt = null;
  if (input.expiresAt) {
    const d = new Date(input.expiresAt);
    if (Number.isNaN(d.getTime())) throw errors.badRequest("expiresAt is not a valid date.");
    expiresAt = d.toISOString();
  }
  const days = input.days ? Math.floor(Number(input.days)) : null;
  if (days !== null && (!Number.isFinite(days) || days < 1 || days > 36500)) {
    throw errors.badRequest("days must be between 1 and 36500.");
  }
  if (expiresAt && days) throw errors.badRequest("Use either expiresAt or days, not both.");

  const key = generateLicenseKey();
  const id = randomUUID();
  const { rows } = await db.query(
    `INSERT INTO licenses (id, key_hash, key_hint, plan, email, note, max_devices, daily_limit, expires_at, duration_days)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING *`,
    [
      id,
      hashKey(key),
      keyHint(key),
      plan,
      input.email ? String(input.email).trim().toLowerCase().slice(0, 254) : null,
      input.note ? String(input.note).slice(0, 500) : null,
      input.maxDevices ?? null,
      input.dailyLimit ?? null,
      expiresAt,
      days,
    ],
  );
  await logEvent(db, id, "created");
  return { license: rows[0], key };
}

// Bind `device` to the license behind `rawKey`.
// Throws ApiError for every refusal; returns the license row on success.
export async function activateLicense(db, config, { device, rawKey, replaceOldest = false, ipHash = null }) {
  const key = normalizeKey(rawKey);
  if (!key) throw errors.badRequest("That doesn't look like a license key. Expected XAIGC-XXXXX-XXXXX-XXXXX-XXXXX.", "invalid_key");

  return db.tx(async (t) => {
    const found = await t.query("SELECT * FROM licenses WHERE key_hash = $1 FOR UPDATE", [hashKey(key)]);
    const license = found.rows[0];
    if (!license) throw new ApiError(404, "invalid_key", "License key not recognized. Check for typos and try again.");

    const state = licenseState(license);
    if (state === "revoked") throw errors.forbidden("license_revoked", "This license has been revoked. Contact support if you think that's a mistake.");
    if (state === "expired") throw errors.forbidden("license_expired", "This license has expired. Renew it to keep generating.");

    if (device.license_id === license.id) return license; // already active here

    const plan = planFor(config, license);
    const bound = await t.query(
      "SELECT id, last_seen_at FROM devices WHERE license_id = $1 AND id <> $2 ORDER BY last_seen_at ASC",
      [license.id, device.id],
    );

    // Activation churn: stops one key being passed around a group by
    // activating and deactivating in turn.
    const resetAt = license.devices_reset_at ? new Date(license.devices_reset_at).getTime() : 0;
    const since = new Date(Math.max(Date.now() - CHURN_WINDOW_MS, resetAt)).toISOString();
    const churn = await t.query(
      "SELECT count(*)::int AS n FROM license_events WHERE license_id = $1 AND type = 'activated' AND ts > $2",
      [license.id, since],
    );
    // Scales with the seat count so a large license can still roll out.
    const churnLimit = Math.max(config.limits.activationsPer30Days, plan.maxDevices * 3);
    if (num(churn.rows[0].n) >= churnLimit) {
      throw new ApiError(
        429,
        "activation_limit",
        "This license has been activated on too many devices recently. Contact support to reset it.",
      );
    }

    if (bound.rows.length >= plan.maxDevices) {
      if (!replaceOldest) {
        throw errors.conflict(
          "device_limit",
          `This license is already active on ${bound.rows.length} device${bound.rows.length === 1 ? "" : "s"} (limit ${plan.maxDevices}).`,
          { devicesUsed: bound.rows.length, maxDevices: plan.maxDevices, canReplace: true },
        );
      }
      const drop = bound.rows.slice(0, bound.rows.length - plan.maxDevices + 1);
      for (const old of drop) {
        await t.query("UPDATE devices SET license_id = NULL, activated_at = NULL WHERE id = $1", [old.id]);
        await logEvent(t, license.id, "deactivated", { deviceId: old.id, detail: "replaced by another device", ipHash });
      }
    }

    await t.query("UPDATE devices SET license_id = $1, activated_at = now() WHERE id = $2", [license.id, device.id]);

    // The clock on duration-based licenses starts at first activation.
    const updated = await t.query(
      `UPDATE licenses SET
         first_activated_at = COALESCE(first_activated_at, now()),
         expires_at = CASE
           WHEN expires_at IS NULL AND duration_days IS NOT NULL AND first_activated_at IS NULL
             THEN now() + make_interval(days => duration_days)
           ELSE expires_at END,
         updated_at = now()
       WHERE id = $1
       RETURNING *`,
      [license.id],
    );
    await logEvent(t, license.id, "activated", { deviceId: device.id, ipHash });
    return updated.rows[0];
  });
}

export async function deactivateDevice(db, { device, ipHash = null }) {
  if (!device.license_id) return false;
  await db.tx(async (t) => {
    await t.query("UPDATE devices SET license_id = NULL, activated_at = NULL WHERE id = $1", [device.id]);
    await logEvent(t, device.license_id, "deactivated", { deviceId: device.id, ipHash });
  });
  return true;
}

/* ----------------------------- admin operations ----------------------------- */

export async function listLicenses(db, { q = "", status = "", limit = 50, offset = 0, day }) {
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    const i = params.length;
    // Search by email, note, hint, or a full key pasted into the box.
    const asKey = normalizeKey(q);
    let clause = `(lower(coalesce(l.email, '')) LIKE $${i} OR lower(coalesce(l.note, '')) LIKE $${i} OR lower(l.key_hint) LIKE $${i}`;
    if (asKey) {
      params.push(hashKey(asKey));
      clause += ` OR l.key_hash = $${params.length}`;
    }
    where.push(clause + ")");
  }
  if (status === "active") where.push("l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > now())");
  else if (status === "expired") where.push("l.status = 'active' AND l.expires_at IS NOT NULL AND l.expires_at <= now()");
  else if (status === "revoked") where.push("l.status = 'revoked'");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await db.query(`SELECT count(*)::int AS n FROM licenses l ${whereSql}`, params);
  params.push(`${day}`, limit, offset);
  const rows = await db.query(
    `SELECT l.*,
            (SELECT count(*)::int FROM devices d WHERE d.license_id = l.id) AS devices_used,
            COALESCE((SELECT u.count FROM usage_daily u WHERE u.subject = 'lic:' || l.id::text AND u.day = $${params.length - 2}), 0) AS used_today
     FROM licenses l
     ${whereSql}
     ORDER BY l.created_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: num(total.rows[0].n), licenses: rows.rows };
}

export async function getLicenseDetail(db, id, { day }) {
  const lic = await db.query(
    `SELECT l.*,
            (SELECT count(*)::int FROM devices d WHERE d.license_id = l.id) AS devices_used,
            COALESCE((SELECT u.count FROM usage_daily u WHERE u.subject = 'lic:' || l.id::text AND u.day = $2), 0) AS used_today
     FROM licenses l WHERE l.id = $1`,
    [id, day],
  );
  if (!lic.rows[0]) throw errors.notFound("License not found.");
  const [devices, events, usage, networks] = await Promise.all([
    db.query(
      `SELECT id, activated_at, last_seen_at, created_at, client_version, total_generations, blocked
       FROM devices WHERE license_id = $1 ORDER BY last_seen_at DESC`,
      [id],
    ),
    db.query("SELECT ts, type, device_id, detail FROM license_events WHERE license_id = $1 ORDER BY ts DESC LIMIT 50", [id]),
    db.query(
      "SELECT day, count, tokens_in, tokens_out FROM usage_daily WHERE subject = $1 ORDER BY day DESC LIMIT 30",
      [`lic:${id}`],
    ),
    // Many distinct networks in a day is the usual signature of a shared key.
    db.query(
      "SELECT count(DISTINCT ip_hash)::int AS n FROM usage_events WHERE license_id = $1 AND ts > now() - interval '24 hours'",
      [id],
    ),
  ]);
  return {
    license: lic.rows[0],
    devices: devices.rows,
    events: events.rows,
    usage: usage.rows.map((r) => ({ day: r.day, count: num(r.count), tokensIn: num(r.tokens_in), tokensOut: num(r.tokens_out) })),
    networks24h: num(networks.rows[0].n),
  };
}

export async function updateLicense(db, config, id, patch) {
  const sets = [];
  const params = [];
  const events = [];
  const set = (column, value) => {
    params.push(value);
    sets.push(`${column} = $${params.length}`);
  };

  if (patch.status !== undefined) {
    if (!["active", "revoked"].includes(patch.status)) throw errors.badRequest("status must be 'active' or 'revoked'.");
    set("status", patch.status);
    events.push(patch.status === "revoked" ? "revoked" : "restored");
  }
  if (patch.plan !== undefined) {
    if (!config.plans[patch.plan]) throw errors.badRequest(`Unknown plan "${patch.plan}".`);
    set("plan", patch.plan);
  }
  if (patch.expiresAt !== undefined) {
    if (patch.expiresAt === null) set("expires_at", null);
    else {
      const d = new Date(patch.expiresAt);
      if (Number.isNaN(d.getTime())) throw errors.badRequest("expiresAt is not a valid date.");
      set("expires_at", d.toISOString());
    }
    // An explicit expiry (or "never") replaces a pending "N days from first
    // activation", which would otherwise overwrite it on activation.
    if (patch.durationDays === undefined) set("duration_days", null);
  }
  if (patch.durationDays !== undefined) set("duration_days", patch.durationDays);
  if (patch.maxDevices !== undefined) set("max_devices", patch.maxDevices);
  if (patch.dailyLimit !== undefined) set("daily_limit", patch.dailyLimit);
  if (patch.email !== undefined) set("email", patch.email ? String(patch.email).trim().toLowerCase().slice(0, 254) : null);
  if (patch.note !== undefined) set("note", patch.note ? String(patch.note).slice(0, 500) : null);
  if (!sets.length) throw errors.badRequest("Nothing to update.");

  params.push(id);
  const { rows } = await db.query(
    `UPDATE licenses SET ${sets.join(", ")}, updated_at = now() WHERE id = $${params.length} RETURNING *`,
    params,
  );
  if (!rows[0]) throw errors.notFound("License not found.");
  for (const type of events) await logEvent(db, id, type);
  return rows[0];
}

// Issue a new key for the same license (lost or leaked key). Devices stay
// bound: they authenticate with their own device tokens, not with the key.
export async function rotateLicenseKey(db, id) {
  const key = generateLicenseKey();
  const { rows } = await db.query(
    "UPDATE licenses SET key_hash = $1, key_hint = $2, updated_at = now() WHERE id = $3 RETURNING *",
    [hashKey(key), keyHint(key), id],
  );
  if (!rows[0]) throw errors.notFound("License not found.");
  await logEvent(db, id, "rotated");
  return { license: rows[0], key };
}

export async function resetLicenseDevices(db, id) {
  return db.tx(async (t) => {
    const lic = await t.query("UPDATE licenses SET devices_reset_at = now(), updated_at = now() WHERE id = $1 RETURNING id", [id]);
    if (!lic.rows[0]) throw errors.notFound("License not found.");
    const freed = await t.query("UPDATE devices SET license_id = NULL, activated_at = NULL WHERE license_id = $1 RETURNING id", [id]);
    await logEvent(t, id, "reset", { detail: `${freed.rows.length} device(s) released` });
    return freed.rows.length;
  });
}
