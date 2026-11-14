// Device identity.
//
// Each extension install registers once and receives an opaque bearer token.
// Only the SHA-256 of the token is stored. The install id is a random secret
// the extension keeps in chrome.storage.sync, so a reinstall on the same
// Chrome profile comes back as the same device (same trial counters, same
// license binding) instead of a fresh one.

import { randomUUID } from "node:crypto";
import { ApiError, errors } from "../errors.js";
import { num } from "../db/index.js";
import { randomToken, sha256 } from "./crypto.js";

const installHash = (installId) => sha256(`xaigc-install:${installId}`);
const tokenHash = (token) => sha256(`xaigc-token:${token}`);

export async function registerDevice(db, config, { installId, clientVersion, ipHash }) {
  const hash = installHash(installId);
  const token = randomToken("xd");

  for (let attempt = 0; attempt < 2; attempt++) {
    const existing = await db.query("SELECT * FROM devices WHERE install_hash = $1", [hash]);
    if (existing.rows[0]) {
      const device = existing.rows[0];
      if (device.blocked) throw errors.forbidden("device_blocked", "This install has been blocked. Contact support.");
      // Re-registration rotates the token, which also invalidates a stolen one.
      const updated = await db.query(
        `UPDATE devices SET token_hash = $1, client_version = $2, last_ip_hash = $3, last_seen_at = now()
         WHERE id = $4 RETURNING *`,
        [tokenHash(token), clientVersion || null, ipHash, device.id],
      );
      return { device: updated.rows[0], token, created: false };
    }

    const recent = await db.query(
      "SELECT count(*)::int AS n FROM devices WHERE ip_hash = $1 AND created_at > now() - interval '24 hours'",
      [ipHash],
    );
    if (num(recent.rows[0].n) >= config.limits.devicesPerIpPerDay) {
      throw new ApiError(429, "too_many_devices", "Too many new installs from this network today. Try again tomorrow.", {
        retryAfter: 3600,
      });
    }

    try {
      const inserted = await db.query(
        `INSERT INTO devices (id, token_hash, install_hash, ip_hash, last_ip_hash, client_version)
         VALUES ($1, $2, $3, $4, $4, $5) RETURNING *`,
        [randomUUID(), tokenHash(token), hash, ipHash, clientVersion || null],
      );
      return { device: inserted.rows[0], token, created: true };
    } catch (err) {
      // Two registrations raced on the same install id: loop and take the update path.
      if (err?.code === "23505" && attempt === 0) continue;
      throw err;
    }
  }
  throw new Error("device registration failed");
}

// Resolve a bearer token to its device row, with the bound license (or null)
// attached as `device.license`.
export async function authenticateDevice(db, token) {
  if (!token || token.length > 200) return null;
  const { rows } = await db.query(
    `SELECT d.*, CASE WHEN l.id IS NULL THEN NULL ELSE to_jsonb(l) END AS license
     FROM devices d LEFT JOIN licenses l ON l.id = d.license_id
     WHERE d.token_hash = $1`,
    [tokenHash(token)],
  );
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
