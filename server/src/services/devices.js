// Device identity.
//
// Each extension install registers once with a random install id and receives
// an opaque bearer token. Only SHA-256 hashes of both are stored. Registering
// an install id that already exists re-issues the token (the old one stops
// working), which is how an install recovers after losing its token. Because
// that needs nothing but the install id, re-issues are capped per day, so an
// install id passed between people cannot serve as a shared seat.

import { randomUUID } from "node:crypto";
import { ApiError, errors } from "../errors.js";
import { num } from "../db/index.js";
import { randomToken, sha256 } from "./crypto.js";

const installHash = (installId) => sha256(`xaigc-install:${installId}`);
const tokenHash = (token) => sha256(`xaigc-token:${token}`);

export async function registerDevice(db, config, { installId, clientVersion, ipHash, now = Date.now() }) {
  const hash = installHash(installId);
  const token = randomToken("xd");
  const day = new Date(now).toISOString().slice(0, 10);

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db.query("SELECT id, blocked FROM devices WHERE install_hash = $1", [hash]);
    if (existing.rows[0]) {
      const device = existing.rows[0];
      if (device.blocked) throw errors.forbidden("device_blocked", "This install has been blocked. Contact support.");
      const updated = await db.query(
        `UPDATE devices SET
           token_hash = $1, client_version = $2, last_ip_hash = $3, last_seen_at = now(),
           rereg_count = CASE WHEN rereg_day = $5 THEN rereg_count + 1 ELSE 1 END,
           rereg_day = $5
         WHERE id = $4 AND (rereg_day IS DISTINCT FROM $5 OR rereg_count < $6)
         RETURNING *`,
        [tokenHash(token), clientVersion || null, ipHash, device.id, day, config.limits.reregistrationsPerDay],
      );
      if (!updated.rows[0]) {
        throw new ApiError(429, "too_many_reinstalls", "This install was set up again too many times today. Try again tomorrow.", {
          retryAfter: 3600,
        });
      }
      return { device: updated.rows[0], token, created: false };
    }

    try {
      const device = await db.tx(async (t) => {
        // Count and insert under one lock per network, so parallel
        // registrations cannot all pass the count before any of them inserts.
        await t.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`devices:${ipHash}`]);
        const recent = await t.query(
          "SELECT count(*)::int AS n FROM devices WHERE ip_hash = $1 AND created_at > now() - interval '24 hours'",
          [ipHash],
        );
        if (num(recent.rows[0].n) >= config.limits.devicesPerIpPerDay) {
          throw new ApiError(429, "too_many_devices", "Too many new installs from this network today. Try again tomorrow.", {
            retryAfter: 3600,
          });
        }
        const inserted = await t.query(
          `INSERT INTO devices (id, token_hash, install_hash, ip_hash, last_ip_hash, client_version)
           VALUES ($1, $2, $3, $4, $4, $5) RETURNING *`,
          [randomUUID(), tokenHash(token), hash, ipHash, clientVersion || null],
        );
        return inserted.rows[0];
      });
      return { device, token, created: true };
    } catch (err) {
      // Two registrations raced on the same install id: loop and take the update path.
      if (err?.code === "23505" && attempt === 0) continue;
      throw err;
    }
  }
  throw new Error("device registration failed");
}

// A device row as the rest of the server sees it:
//   device.license  the bound license (or null). `owner_blocked` is added to
//                   it: a license whose owning account is blocked is unusable
//                   on every browser, however the seat was obtained.
//   device.user     the signed-in account (or null).
const DEVICE_SELECT = `
  SELECT d.*,
         CASE WHEN l.id IS NULL THEN NULL
              ELSE to_jsonb(l) || jsonb_build_object(
                'owner_blocked', COALESCE((SELECT o.blocked FROM users o WHERE o.id = l.user_id), false)) END AS license,
         CASE WHEN u.id IS NULL THEN NULL
              ELSE jsonb_build_object('id', u.id, 'email', u.email, 'name', u.name, 'blocked', u.blocked,
                                      'email_current', u.email_current, 'trial_key', u.trial_key) END AS "user"
  FROM devices d
  LEFT JOIN licenses l ON l.id = d.license_id
  LEFT JOIN users u ON u.id = d.user_id`;

// Resolve a bearer token to its device row, with the bound license and the
// signed-in user (each null when absent) attached as `device.license` and
// `device.user`.
export async function authenticateDevice(db, token) {
  if (!token || token.length > 200) return null;
  const { rows } = await db.query(`${DEVICE_SELECT} WHERE d.token_hash = $1`, [tokenHash(token)]);
  return rows[0] || null;
}

export async function getDevice(db, id) {
  const { rows } = await db.query(`${DEVICE_SELECT} WHERE d.id = $1`, [id]);
  return rows[0] || null;
}

export async function touchDevice(db, deviceId, { ipHash, xhHash, clientVersion, generated = false }) {
  await db.query(
    `UPDATE devices SET
       last_seen_at = now(),
       last_ip_hash = COALESCE($2, last_ip_hash),
       xh_hash = COALESCE($3, xh_hash),
       client_version = COALESCE($4, client_version),
       total_generations = total_generations + $5
     WHERE id = $1`,
    [deviceId, ipHash || null, xhHash || null, clientVersion || null, generated ? 1 : 0],
  );
}

export async function setDeviceBlocked(db, deviceId, blocked, reason) {
  const { rows } = await db.query(
    "UPDATE devices SET blocked = $2, blocked_reason = $3 WHERE id = $1 RETURNING id, blocked, blocked_reason",
    [deviceId, Boolean(blocked), blocked ? String(reason || "blocked by admin").slice(0, 300) : null],
  );
  if (!rows[0]) throw errors.notFound("Device not found.");
  return rows[0];
}
