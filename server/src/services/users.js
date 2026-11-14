// User accounts. A user is a Google account that has signed in at least once.
// Devices (browser installs) point at the user they are signed in to, and
// licenses point at the user who owns them.

import { randomUUID } from "node:crypto";
import { errors } from "../errors.js";
import { num } from "../db/index.js";

// Create the account on first sign-in, refresh email and name afterwards.
export async function upsertGoogleUser(q, { sub, email, name }) {
  const { rows } = await q.query(
    `INSERT INTO users (id, google_sub, email, name) VALUES ($1, $2, $3, $4)
     ON CONFLICT (google_sub) DO UPDATE SET email = EXCLUDED.email, name = EXCLUDED.name, last_login_at = now()
     RETURNING *, (xmax = 0) AS created`,
    [randomUUID(), sub, email, name],
  );
  return rows[0];
}

// Sign a browser out. A license that belongs to the account leaves with it;
// one that was activated on this browser with a key stays.
export async function signOutDevice(db, device, { ipHash = null } = {}) {
  if (!device.user_id) return false;
  await db.tx(async (t) => {
    const owned = device.license && device.license.user_id === device.user_id;
    await t.query(
      `UPDATE devices SET user_id = NULL${owned ? ", license_id = NULL, activated_at = NULL" : ""} WHERE id = $1`,
      [device.id],
    );
    if (owned) {
      await t.query(
        "INSERT INTO license_events (license_id, device_id, type, detail, ip_hash) VALUES ($1, $2, 'deactivated', 'signed out', $3)",
        [device.license.id, device.id, ipHash],
      );
    }
  });
  return true;
}

/* ----------------------------- admin operations ----------------------------- */

const USER_COLUMNS = `
  u.id, u.email, u.name, u.blocked, u.blocked_reason, u.created_at, u.last_login_at,
  (SELECT count(*)::int FROM devices d WHERE d.user_id = u.id) AS devices,
  (SELECT COALESCE(sum(d.total_generations), 0)::int FROM devices d WHERE d.user_id = u.id) AS generations,
  (SELECT max(d.last_seen_at) FROM devices d WHERE d.user_id = u.id) AS last_seen_at,
  (SELECT count(*)::int FROM licenses l
     WHERE l.user_id = u.id AND l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > now())) AS active_licenses,
  (SELECT l.plan FROM licenses l
     WHERE l.user_id = u.id AND l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > now())
     ORDER BY l.created_at DESC LIMIT 1) AS plan,
  COALESCE((SELECT t.used FROM trial_counters t WHERE t.key = 'user:' || u.id::text), 0) AS trial_used`;

export async function listUsers(db, { q = "", filter = "", limit = 50, offset = 0 }) {
  const where = [];
  const params = [];
  if (q) {
    params.push(`%${q.toLowerCase()}%`);
    where.push(`(lower(u.email) LIKE $1 OR lower(coalesce(u.name, '')) LIKE $1)`);
  }
  const licensed = "EXISTS (SELECT 1 FROM licenses l WHERE l.user_id = u.id AND l.status = 'active' AND (l.expires_at IS NULL OR l.expires_at > now()))";
  if (filter === "licensed") where.push(licensed);
  else if (filter === "trial") where.push(`NOT ${licensed}`);
  else if (filter === "blocked") where.push("u.blocked");
  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";

  const total = await db.query(`SELECT count(*)::int AS n FROM users u ${whereSql}`, params);
  params.push(limit, offset);
  const rows = await db.query(
    `SELECT ${USER_COLUMNS} FROM users u ${whereSql}
     ORDER BY u.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );
  return { total: num(total.rows[0].n), users: rows.rows };
}

export async function getUserDetail(db, id) {
  const user = await db.query(`SELECT ${USER_COLUMNS} FROM users u WHERE u.id = $1`, [id]);
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

// Remove an account (for example on a data deletion request). Their browsers
// are signed out. Licenses they owned stay valid as key-only licenses but are
// released from every browser, and their trial record is erased.
export async function deleteUser(db, id) {
  return db.tx(async (t) => {
    const found = await t.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [id]);
    if (!found.rows[0]) throw errors.notFound("User not found.");
    await t.query(
      `UPDATE devices SET license_id = NULL, activated_at = NULL
       WHERE user_id = $1 AND license_id IN (SELECT id FROM licenses WHERE user_id = $1)`,
      [id],
    );
    await t.query("DELETE FROM trial_counters WHERE key = $1", [`user:${id}`]);
    await t.query("DELETE FROM users WHERE id = $1", [id]); // devices.user_id and licenses.user_id become NULL
    return true;
  });
}
