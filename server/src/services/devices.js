// Installs and the drafts they report.
//
// Each extension install registers once with a random install id and receives
// an opaque bearer token. Only SHA-256 hashes of both are stored, with a keyed
// hash of the network it registered from (to stop one network inflating the
// count of installs). Registering an install id that already exists re-issues
// the token, which is how an install recovers after losing it; re-issues are
// capped per day.
//
// A draft report is a kind ("reply", "post"...) and nothing else: never the
// post, the draft or anything about the person.

import { randomUUID } from "node:crypto";
import { ApiError, errors } from "../errors.js";
import { num } from "../db/index.js";
import { randomToken, sha256 } from "./crypto.js";

export const KINDS = ["reply", "question", "quote", "post", "thread", "rewrite"];

const installHash = (installId) => sha256(`xaigc-install:${installId}`);
const tokenHash = (token) => sha256(`xaigc-token:${token}`);
export const utcDay = (now = Date.now()) => new Date(now).toISOString().slice(0, 10);

export async function registerDevice(db, config, { installId, clientVersion, ipHash, now = Date.now() }) {
  const hash = installHash(installId);
  const token = randomToken("xd");
  const day = utcDay(now);

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db.query("SELECT id, blocked FROM devices WHERE install_hash = $1", [hash]);
    if (existing.rows[0]) {
      const device = existing.rows[0];
      if (device.blocked) throw errors.forbidden("device_blocked", "This install has been blocked.");
      const updated = await db.query(
        `UPDATE devices SET
           token_hash = $1, client_version = $2, last_seen_at = now(),
           rereg_count = CASE WHEN rereg_day = $4 THEN rereg_count + 1 ELSE 1 END,
           rereg_day = $4
         WHERE id = $3 AND (rereg_day IS DISTINCT FROM $4 OR rereg_count < $5)
         RETURNING *`,
        [tokenHash(token), clientVersion || null, device.id, day, config.limits.reregistrationsPerDay],
      );
      if (!updated.rows[0]) {
        throw new ApiError(429, "too_many_reinstalls", "This install was registered too many times today. Try again tomorrow.", { retryAfter: 3600 });
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
          throw new ApiError(429, "too_many_devices", "Too many new installs from this network today. Try again tomorrow.", { retryAfter: 3600 });
        }
        const inserted = await t.query(
          `INSERT INTO devices (id, token_hash, install_hash, ip_hash, client_version)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
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

export async function authenticateDevice(db, token) {
  if (!token || token.length > 200) return null;
  const { rows } = await db.query("SELECT * FROM devices WHERE token_hash = $1", [tokenHash(token)]);
  return rows[0] || null;
}

// Count one draft. Returns false when the install has already reported a
// day's worth (the count is then dropped, not refused: the person never sees it).
export async function countDraft(db, config, { device, kind, clientVersion, now = Date.now() }) {
  const day = utcDay(now);
  return db.tx(async (t) => {
    const own = await t.query(
      `INSERT INTO usage_daily (subject, day, count) VALUES ($1, $2, 1)
       ON CONFLICT (subject, day) DO UPDATE SET count = usage_daily.count + 1
       WHERE usage_daily.count < $3
       RETURNING count`,
      [`device:${device.id}`, day, config.limits.draftsPerDevicePerDay],
    );
    if (!own.rows[0]) return false;
    for (const subject of ["drafts", `drafts:${kind}`]) {
      await t.query(
        `INSERT INTO usage_daily (subject, day, count) VALUES ($1, $2, 1)
         ON CONFLICT (subject, day) DO UPDATE SET count = usage_daily.count + 1`,
        [subject, day],
      );
    }
    await t.query(
      `UPDATE devices SET total_generations = total_generations + 1, last_seen_at = now(),
         client_version = COALESCE($2, client_version)
       WHERE id = $1`,
      [device.id, clientVersion || null],
    );
    return true;
  });
}
