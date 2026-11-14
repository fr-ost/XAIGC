// User accounts. A user is a Google account that has signed in at least once.
// Devices (browser installs) point at the user they are signed in to, and
// licenses point at the user who owns them.

import { randomUUID } from "node:crypto";
import { errors } from "../errors.js";
import { num } from "../db/index.js";

// Create the account on first sign-in, refresh email and name afterwards.
//
// `trialKey` is a keyed hash of the Google account id. The free-use counter
// hangs off it instead of the row id, so an account that is deleted and comes
// back the same day does not get a second free allowance.
//
// Google guarantees an address belongs to one account at a time, so whichever
// account just signed in with it is the current holder: any other row still
// carrying that address has a stale copy and can no longer claim licenses
// issued to it.
export async function upsertGoogleUser(db, { sub, email, name }, trialKey) {
  return db.tx(async (t) => {
    const { rows } = await t.query(
      `INSERT INTO users (id, google_sub, email, name, trial_key) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (google_sub) DO UPDATE SET
         email = EXCLUDED.email, name = EXCLUDED.name, email_current = true, last_login_at = now()
       RETURNING *, (xmax = 0) AS created`,
      [randomUUID(), sub, email, name, trialKey],
    );
    await t.query("UPDATE users SET email_current = false WHERE lower(email) = lower($1) AND id <> $2 AND email_current", [
      email,
      rows[0].id,
    ]);
    return rows[0];
  });
}

async function releaseSeat(t, device, detail, ipHash) {
  await t.query("UPDATE devices SET license_id = NULL, activated_at = NULL, seat_source = NULL WHERE id = $1", [device.id]);
  await t.query(
    "INSERT INTO license_events (license_id, device_id, type, detail, ip_hash) VALUES ($1, $2, 'deactivated', $3, $4)",
    [device.license_id, device.id, detail, ipHash],
  );
}

// Point a browser at an account. If it was signed in as someone else and
// holds a seat that came with that other account, the seat goes back first.
export async function signInDevice(db, device, user, { ipHash = null } = {}) {
  await db.tx(async (t) => {
    if (device.license_id && device.seat_source === "account" && device.user_id && device.user_id !== user.id) {
      await releaseSeat(t, device, "another account signed in", ipHash);
    }
    await t.query("UPDATE devices SET user_id = $1, detached_license_id = NULL WHERE id = $2", [user.id, device.id]);
  });
}

// Sign a browser out. A seat that came with the account leaves with it; a
// seat someone got by typing the key on this browser stays.
export async function signOutDevice(db, device, { ipHash = null } = {}) {
  if (!device.user_id) return false;
  await db.tx(async (t) => {
    if (device.license_id && device.seat_source === "account") await releaseSeat(t, device, "signed out", ipHash);
    await t.query("UPDATE devices SET user_id = NULL WHERE id = $1", [device.id]);
  });
  return true;
}

/* ----------------------------- admin operations ----------------------------- */

// `since` is the number of the query parameter holding today's midnight
// (UTC). Free use is counted per day, so a counter last started before then
// reads as nothing used.
const userColumns = (since) => `
  u.id, u.email, u.name, u.blocked, u.blocked_reason, u.created_at, u.last_login_at,
  (SELECT count(*)::int FROM devices d WHERE d.user_id = u.id) AS devices,
  (SELECT COALESCE(sum(d.total_generations), 0)::int FROM devices d WHERE d.user_id = u.id) AS generations,
  (SELECT max(d.last_seen_at) FROM devices d WHERE d.user_id = u.id) AS last_seen_at,
  (SELECT count(*)::int FROM licenses l
     WHERE l.user_id = u.id AND l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > now())) AS active_licenses,
  (SELECT l.plan FROM licenses l
     WHERE l.user_id = u.id AND l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > now())
     ORDER BY l.created_at DESC LIMIT 1) AS plan,
  COALESCE((SELECT t.used FROM trial_counters t
              WHERE t.key = 'user:' || u.trial_key AND t.window_start >= $${since}::timestamptz), 0) AS free_used`;

const midnight = (day) => `${day}T00:00:00.000Z`;

export async function listUsers(db, { q = "", filter = "", limit = 50, offset = 0, day }) {
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(u.email) LIKE $1 OR lower(coalesce(u.name, '')) LIKE $1)`);
  }
  const licensed = "EXISTS (SELECT 1 FROM licenses l WHERE l.user_id = u.id AND l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > now()))";
  if (filter === "licensed") where.push(licensed);
  else if (filter === "free") where.push(`NOT ${licensed}`);
  else if (filter === "blocked") where.push("u.blocked");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await db.query(`SELECT count(*)::int AS n FROM users u ${whereSql}`, params);
  params.push(limit, offset, midnight(day));
  const rows = await db.query(
    `SELECT ${userColumns(params.length)} FROM users u ${whereSql}
     ORDER BY u.created_at DESC LIMIT $${params.length - 2} OFFSET $${params.length - 1}`,
    params,
  );
  return { total: num(total.rows[0].n), users: rows.rows };
}

export async function getUserDetail(db, id, { day }) {
  const user = await db.query(`SELECT ${userColumns(2)} FROM users u WHERE u.id = $1`, [id, midnight(day)]);
  if (!user.rows[0]) throw errors.notFound("User not found.");
  const [devices, licenses] = await Promise.all([
    db.query(
      `SELECT d.id, d.created_at, d.last_seen_at, d.client_version, d.total_generations, d.blocked, l.key_hint, l.plan
       FROM devices d LEFT JOIN licenses l ON l.id = d.license_id
       WHERE d.user_id = $1 ORDER BY d.last_seen_at DESC`,
      [id],
    ),
    db.query(
      `SELECT l.*, (SELECT count(*)::int FROM devices d WHERE d.license_id = l.id) AS devices_used
       FROM licenses l WHERE l.user_id = $1 ORDER BY l.created_at DESC`,
      [id],
    ),
  ]);
  return { user: user.rows[0], devices: devices.rows, licenses: licenses.rows };
}

export async function setUserBlocked(db, id, blocked, reason) {
  const { rows } = await db.query(
    "UPDATE users SET blocked = $2, blocked_reason = $3 WHERE id = $1 RETURNING id, blocked, blocked_reason",
    [id, Boolean(blocked), blocked ? String(reason || "blocked by admin").slice(0, 300) : null],
  );
  if (!rows[0]) throw errors.notFound("User not found.");
  return rows[0];
}

// Remove an account (for example on a data deletion request).
//
// Erased: the account row (Google id, email, name) and the email address on
// every license it owned, which become key-only licenses. Their browsers are
// signed out and give back the seats that came with the account.
//
// Kept on purpose: the free-use counter, which is keyed by a hash of the
// Google id and holds a number, so the same Google account cannot collect a
// second free allowance in a day by being deleted. Devices and usage rows remain too; they carry no
// name, email or Google id.
//
// A block is part of the account row, so deleting a blocked account lifts the
// block. Block abusers; do not delete them.
export async function deleteUser(db, id) {
  return db.tx(async (t) => {
    const found = await t.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [id]);
    if (!found.rows[0]) throw errors.notFound("User not found.");
    // Lock the owned licenses first: attaching one takes the same lock, so a
    // sign-in racing this delete cannot leave a seat bound to a signed-out browser.
    const owned = await t.query("SELECT id FROM licenses WHERE user_id = $1 ORDER BY id FOR UPDATE", [id]);
    const ids = owned.rows.map((r) => r.id);
    if (ids.length) {
      await t.query(
        `UPDATE devices SET license_id = NULL, activated_at = NULL, seat_source = NULL
         WHERE license_id = ANY($1::uuid[]) AND seat_source = 'account'`,
        [ids],
      );
      await t.query("UPDATE licenses SET email = NULL, updated_at = now() WHERE id = ANY($1::uuid[])", [ids]);
    }
    await t.query("DELETE FROM users WHERE id = $1", [id]); // devices.user_id and licenses.user_id become NULL
    return true;
  });
}
